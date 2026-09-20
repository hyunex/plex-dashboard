import { readdirSync, statSync, existsSync, openSync, readSync, closeSync } from "fs";
import { join, basename } from "path";
import { LogParser } from "./log_parser.ts";
import { insertActivity, cleanupExpiredLogs, db, getCachedLocation } from "./database.ts";
import { lookupIpsBatch } from "./geoip.ts";

export const PLEX_LOG_DIR =
  process.env.PLEX_LOG_DIR ||
  "/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Logs";

export interface LogGroupInfo {
  id: string; // e.g. "Plex Media Server", "plugin:com.plexapp.agents.sjva_agent"
  displayName: string;
  category: "main" | "scanner" | "plugin" | "other";
  files: string[]; // sorted oldest to newest
  totalSize: number;
  lastWrite: number; // newest 파일 mtime (ms)
}

// 1. 디렉토리 내의 모든 로그 그룹 검색 및 분할 파일 정렬
export function getAvailableLogGroups(): LogGroupInfo[] {
  const groups = new Map<string, { category: LogGroupInfo["category"]; files: { path: string; num: number; size: number; mtime: number }[] }>();

  // 메인 디렉토리 파일 스캔
  if (existsSync(PLEX_LOG_DIR)) {
    const entries = readdirSync(PLEX_LOG_DIR, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const fname = ent.name;
      const fullPath = join(PLEX_LOG_DIR, fname);
      const st = statSync(fullPath);

      // 예: Plex Media Server.log, Plex Media Server.1.log, Plex Media Server.2.log
      // 예: sjva.scanner.show.log, sjva.scanner.show.log.1
      let baseName = "";
      let rotNum = 0; // 0 = newest (.log)

      // 정규식 1: Name.<N>.log
      const m1 = fname.match(/^(.*?)\.(\d+)\.log$/);
      // 정규식 2: Name.log.<N>
      const m2 = fname.match(/^(.*?\.log)\.(\d+)$/);
      // 정규식 3: Name.log
      const m3 = fname.match(/^(.*?)\.log$/);

      if (m1) {
        baseName = m1[1];
        rotNum = parseInt(m1[2], 10);
      } else if (m2) {
        baseName = m2[1].replace(/\.log$/, "");
        rotNum = parseInt(m2[2], 10);
      } else if (m3) {
        baseName = m3[1];
        rotNum = 0;
      } else {
        continue;
      }

      let category: LogGroupInfo["category"] = "other";
      if (baseName === "Plex Media Server") category = "main";
      else if (baseName.includes("Scanner")) category = "scanner";

      if (!groups.has(baseName)) {
        groups.set(baseName, { category, files: [] });
      }
      groups.get(baseName)!.files.push({ path: fullPath, num: rotNum, size: st.size });
    }
  }

  // 플러그인 디렉토리 파일 스캔
  const pluginDir = join(PLEX_LOG_DIR, "PMS Plugin Logs");
  if (existsSync(pluginDir)) {
    const pEntries = readdirSync(pluginDir, { withFileTypes: true });
    for (const ent of pEntries) {
      if (!ent.isFile()) continue;
      const fname = ent.name;
      const fullPath = join(pluginDir, fname);
      const st = statSync(fullPath);

      let baseName = "";
      let rotNum = 0;

      const m1 = fname.match(/^(.*?)\.(\d+)\.log$/);
      const m2 = fname.match(/^(.*?\.log)\.(\d+)$/);
      const m3 = fname.match(/^(.*?)\.log$/);

      if (m1) {
        baseName = m1[1];
        rotNum = parseInt(m1[2], 10);
      } else if (m2) {
        baseName = m2[1].replace(/\.log$/, "");
        rotNum = parseInt(m2[2], 10);
      } else if (m3) {
        baseName = m3[1];
        rotNum = 0;
      } else {
        continue;
      }

      const groupId = `plugin:${baseName}`;
      if (!groups.has(groupId)) {
        groups.set(groupId, { category: "plugin", files: [] });
      }
      groups.get(groupId)!.files.push({ path: fullPath, num: rotNum, size: st.size });
    }
  }

  const result: LogGroupInfo[] = [];

  for (const [id, grp] of groups.entries()) {
    // 분할 파일 정렬: 큰 번호가 더 과거 파일이므로 (5 -> 4 -> 3 -> 2 -> 1 -> 0) 순으로 정렬
    grp.files.sort((a, b) => b.num - a.num);
    const files = grp.files.map((f) => f.path);
    const totalSize = grp.files.reduce((acc, f) => acc + f.size, 0);
    const lastWrite = grp.files.reduce((acc, f) => Math.max(acc, f.mtime), 0);

    let displayName = id;
    if (id.startsWith("plugin:")) {
      displayName = `[플러그인] ${id.replace("plugin:", "")}`;
    } else if (id === "Plex Media Server") {
      displayName = `[메인] Plex Media Server`;
    }

    result.push({
      id,
      displayName,
      category: grp.category,
      files,
      totalSize,
      lastWrite,
    });
  }

  // 정렬: 메인/스캐너/기타는 이름순, 플러그인은 최근 기록(mtime) 내림차순
  const catOrder: Record<string, number> = { main: 1, scanner: 2, plugin: 3, other: 4 };
  result.sort((a, b) => {
    const orderA = catOrder[a.category] ?? 5;
    const orderB = catOrder[b.category] ?? 5;
    if (orderA !== orderB) return orderA - orderB;
    if (a.category === "plugin" && b.category === "plugin") return b.lastWrite - a.lastWrite;
    return a.displayName.localeCompare(b.displayName);
  });

  return result;
}

// 2. 가상 분할 로그 통합 뷰어 읽기 엔진
export interface LogViewResult {
  lines: string[];
  totalLines: number;
  fromLine: number; // 0-based
  toLine: number;
  isBottom: boolean;
  hasMorePast: boolean;
  hasMoreFuture: boolean;
}

export async function readUnifiedLogLines(
  groupId: string,
  options: {
    limit?: number;
    beforeLine?: number; // 특정 라인 번호 이전(과거)으로 읽기
    afterLine?: number; // 특정 라인 번호 이후(최신)로 읽기
  }
): Promise<LogViewResult> {
  const limit = Math.max(10, Math.min(options.limit ?? 100, 1000));
  const allGroups = getAvailableLogGroups();
  const group = allGroups.find((g) => g.id === groupId) || allGroups[0];

  if (!group || group.files.length === 0) {
    return {
      lines: ["(로그 파일이 없습니다.)"],
      totalLines: 0,
      fromLine: 0,
      toLine: 0,
      isBottom: true,
      hasMorePast: false,
      hasMoreFuture: false,
    };
  }

  // 파일들의 내용을 시간순으로 연결한 라인 인덱싱
  // 성능 최적화: 파일들을 순서대로 읽되, Bun.file의 텍스트를 스트림 처리
  const fileLineBlocks: string[][] = [];
  for (const filePath of group.files) {
    if (existsSync(filePath)) {
      const file = Bun.file(filePath);
      const text = await file.text();
      const lines = text.split("\n");
      // 마지막 줄이 빈 줄인 경우 제거
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      fileLineBlocks.push(lines);
    }
  }

  // 하나의 가상 플랫 라인 배열 구성
  const allLines: string[] = [];
  for (const block of fileLineBlocks) {
    for (let i = 0; i < block.length; i++) {
      allLines.push(block[i]);
    }
  }

  const totalLines = allLines.length;
  let fromLine = 0;
  let toLine = 0;

  if (options.beforeLine !== undefined) {
    // 과거 로그 로딩: beforeLine 바로 앞부터 위로 limit 줄
    toLine = Math.min(Math.max(0, options.beforeLine), totalLines);
    fromLine = Math.max(0, toLine - limit);
  } else if (options.afterLine !== undefined) {
    // 최신 로그 갱신: afterLine 이후로 limit 줄
    fromLine = Math.min(Math.max(0, options.afterLine), totalLines);
    toLine = Math.min(fromLine + limit, totalLines);
  } else {
    // 기본값: 항상 최신 로그가 맨 아래! 끝에서 limit줄
    fromLine = Math.max(0, totalLines - limit);
    toLine = totalLines;
  }

  const lines = allLines.slice(fromLine, toLine);
  const isBottom = toLine >= totalLines;
  const hasMorePast = fromLine > 0;
  const hasMoreFuture = toLine < totalLines;

  return {
    lines,
    totalLines,
    fromLine,
    toLine,
    isBottom,
    hasMorePast,
    hasMoreFuture,
  };
}

// 3. 주기적 증분 로그 수집 데몬
export class LogCollector {
  private parser = new LogParser();
  private timer: NodeJS.Timeout | null = null;
  private isImporting = false;

  constructor(private intervalSec = 30) {}

  public async start() {
    console.log(`[LogCollector] 로그 수집기 시작 (주기: ${this.intervalSec}초)`);
    // 즉시 첫 회 수집 실행 (기존 쌓인 분할 로그 포함)
    await this.runImport();

    this.timer = setInterval(async () => {
      await this.runImport();
    }, this.intervalSec * 1000);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async runImport(): Promise<{ importedCount: number }> {
    if (this.isImporting) return { importedCount: 0 };
    this.isImporting = true;

    let totalImported = 0;
    try {
      // 1. Plex Media Server 로그 그룹 분할 파일들 가져오기
      const groups = getAvailableLogGroups();
      const pmsGroup = groups.find((g) => g.id === "Plex Media Server");

      if (pmsGroup && pmsGroup.files.length > 0) {
        for (const filePath of pmsGroup.files) {
          const count = await this.importFile(filePath);
          totalImported += count;
        }
      }

      // 2. 만료된 로그 정리
      cleanupExpiredLogs();
    } catch (err) {
      console.error("[LogCollector] 로그 수집 중 오류:", err);
    } finally {
      this.isImporting = false;
    }

    return { importedCount: totalImported };
  }

  private async importFile(filePath: string): Promise<number> {
    if (!existsSync(filePath)) return 0;

    const fileName = basename(filePath);
    const st = statSync(filePath);
    const currentSize = st.size;

    // 커서 조회
    const cursor = db
      .query(
        "SELECT last_offset, last_inode FROM log_cursors WHERE file_name = ?"
      )
      .get(fileName) as { last_offset: number; last_inode: number } | null;

    let lastOffset = cursor?.last_offset ?? 0;
    const lastInode = cursor?.last_inode ?? 0;

    // 파일이 줄어들었거나 inode가 바뀌었다면 (로테이션 발생 시)
    if (currentSize < lastOffset || (lastInode > 0 && lastInode !== st.ino)) {
      lastOffset = 0;
    }

    if (currentSize === lastOffset) {
      // 새로운 내용 없음
      return 0;
    }

    // 파일에서 lastOffset 부터 currentSize 까지 읽기
    const bytesToRead = currentSize - lastOffset;
    const buffer = Buffer.alloc(bytesToRead);

    const fd = openSync(filePath, "r");
    try {
      readSync(fd, buffer, 0, bytesToRead, lastOffset);
    } finally {
      closeSync(fd);
    }

    const chunkStr = buffer.toString("utf-8");
    const lines = chunkStr.split("\n");
    let imported = 0;
    const pendingIps = new Set<string>();
    for (const line of lines) {
      if (!line) continue;
      const activity = this.parser.parseLine(line);
      if (activity) {
        if (activity.client_ip && !activity.ip_location) {
          const cached = getCachedLocation(activity.client_ip);
          if (cached) activity.ip_location = cached;
          else pendingIps.add(activity.client_ip);
        }
        insertActivity(activity);
        imported++;
      }
    }
    if (pendingIps.size > 0) {
      const locMap = await lookupIpsBatch([...pendingIps]);
      for (const [ip, loc] of Object.entries(locMap)) {
        db.run(`UPDATE activity_logs SET ip_location = ? WHERE (ip_location IS NULL OR ip_location = '') AND client_ip = ?`, [loc, ip]);
      }
    }

    // 커서 업데이트
    db.query(
      `INSERT OR REPLACE INTO log_cursors (file_name, last_offset, last_inode, last_parsed_at)
       VALUES (?, ?, ?, datetime('now', 'localtime'))`
    ).run(fileName, currentSize, st.ino);

    return imported;
  }
}
