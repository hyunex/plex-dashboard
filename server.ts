import { join, resolve } from "path";
import { existsSync } from "fs";
import {
  getActivities,
  getUserList,
  getAliases,
  setAlias,
  getDashboardStats,
  getSetting,
  setSetting,
  cleanupExpiredLogs,
} from "./database.ts";
import {
  getAvailableLogGroups,
  readUnifiedLogLines,
  LogCollector,
} from "./log_collector.ts";
import { lookupIpsBatch } from "./geoip.ts";

const PORT = parseInt(process.env.PORT || getSetting("port", "32420"), 10);
const PUBLIC_DIR = join(import.meta.dir, "public");

// 주기적 로그 수집기 시작
const importIntervalSec = parseInt(getSetting("import_interval_sec", "30"), 10);
const collector = new LogCollector(importIntervalSec);
collector.start();

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-XSS-Protection": "1; mode=block",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS,
    },
  });
}

/** 로그 라인 내 민감 토큰 마스킹 필터 */
function maskSensitiveLog(line: string): string {
  return line
    .replace(/(X-Plex-Token(?:%3D|=|\s*=>\s*))([a-zA-Z0-9_-]{8,})/gi, "$1[MASKED_TOKEN]")
    .replace(/(token=)([a-zA-Z0-9_-]{8,})/gi, "$1[MASKED_TOKEN]")
    .replace(/(auth token \()([a-zA-Z0-9_-]+)(\))/gi, "$1[MASKED_TOKEN]$3");
}

function serveStatic(filePath: string): Response {
  const resolvedPublic = resolve(PUBLIC_DIR);
  const resolvedTarget = resolve(filePath);

  // Path Traversal 방어: 대상 파일 경로가 반드시 public 디렉토리 하위여야 함
  if (!resolvedTarget.startsWith(resolvedPublic)) {
    return new Response("Forbidden", { status: 403, headers: SECURITY_HEADERS });
  }

  if (!existsSync(resolvedTarget)) {
    return new Response("Not Found", { status: 404, headers: SECURITY_HEADERS });
  }
  const file = Bun.file(resolvedTarget);
  return new Response(file, {
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      ...SECURITY_HEADERS,
    },
  });
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // 1. 활동 내역 조회 API
    if (pathname === "/api/activities" && req.method === "GET") {
      const user = url.searchParams.get("user") || undefined;
      const type = url.searchParams.get("type") || undefined;
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      const hideStream = url.searchParams.get("hideStream") === "1" || getSetting("show_stream_downloads", "1") === "0";
      const res = getActivities({ user, type, limit, offset, hideStream });
      return jsonResponse(res);
    }

    // 2. 사용자 목록 API
    if (pathname === "/api/users" && req.method === "GET") {
      const users = getUserList();
      return jsonResponse(users);
    }

    // 2-1. 사용자 별칭 조회 API
    if (pathname === "/api/aliases" && req.method === "GET") {
      return jsonResponse(getAliases());
    }

    // 2-2. 사용자 별칭 저장 API
    if (pathname === "/api/aliases" && req.method === "POST") {
      try {
        const body = (await req.json()) as { user_name?: string; alias?: string };
        if (!body.user_name) return jsonResponse({ error: "user_name이 필요합니다." }, 400);
        setAlias(body.user_name, body.alias ?? "");
        return jsonResponse({ success: true });
      } catch (err) {
        return jsonResponse({ error: "잘못된 요청 형식입니다." }, 400);
      }
    }

    // 3. 통계 API
    if (pathname === "/api/stats" && req.method === "GET") {
      const stats = getDashboardStats();
      return jsonResponse(stats);
    }

    // 4. 로그 그룹 목록 API
    if (pathname === "/api/log-groups" && req.method === "GET") {
      const groups = getAvailableLogGroups();
      return jsonResponse(groups);
    }

    // 5. 가상 분할 로그 통합 뷰어 API
    if (pathname === "/api/logs/view" && req.method === "GET") {
      const rawGroupId = url.searchParams.get("groupId") || "Plex Media Server";
      // groupId 안전 검증: 허용된 문자열만 통과
      const groupId = rawGroupId.replace(/[^a-zA-Z0-9_.\- ]/g, "");
      if (!groupId) {
        return jsonResponse({ error: "유효하지 않은 groupId입니다." }, 400);
      }

      const parsedLimit = parseInt(url.searchParams.get("limit") || "100", 10);
      const limit = Math.min(Math.max(1, isNaN(parsedLimit) ? 100 : parsedLimit), 1000);
      const beforeLineStr = url.searchParams.get("beforeLine");
      const afterLineStr = url.searchParams.get("afterLine");

      const beforeLine = beforeLineStr ? parseInt(beforeLineStr, 10) : undefined;
      const afterLine = afterLineStr ? parseInt(afterLineStr, 10) : undefined;

      const viewResult = await readUnifiedLogLines(groupId, {
        limit,
        beforeLine,
        afterLine,
      });

      // 민감 토큰 마스킹 처리 후 반환
      viewResult.lines = viewResult.lines.map(maskSensitiveLog);
      return jsonResponse(viewResult);
    }

    // 6. 수동 즉시 Import API
    if (pathname === "/api/import-now" && req.method === "POST") {
      const res = await collector.runImport();
      return jsonResponse({ success: true, importedCount: res.importedCount });
    }

    // 7. 설정 조회 API
    if (pathname === "/api/settings" && req.method === "GET") {
      const settings = {
        retention_days: getSetting("retention_days", "90"),
        import_interval_sec: getSetting("import_interval_sec", "30"),
        port: getSetting("port", "32420"),
        show_stream_downloads: getSetting("show_stream_downloads", "1"),
      };
      return jsonResponse(settings);
    }

    // 7-1. 위치정보 일괄 조회 API (카드 렌더용)
    if (pathname === "/api/locations" && req.method === "POST") {
      try {
        const body = (await req.json()) as { ips?: string[] };
        const safeIps = Array.isArray(body.ips) ? body.ips.slice(0, 100) : [];
        const locMap = await lookupIpsBatch(safeIps);
        return jsonResponse(locMap);
      } catch {
        return jsonResponse({ error: "위치 조회 실패" }, 400);
      }
    }

    // 8. 설정 변경 API
    if (pathname === "/api/settings" && req.method === "POST") {
      try {
        const body = (await req.json()) as {
          retention_days?: string | number;
          import_interval_sec?: string | number;
          show_stream_downloads?: string | number | boolean;
        };
        if (body.retention_days !== undefined) {
          setSetting("retention_days", String(body.retention_days));
          cleanupExpiredLogs();
        }
        if (body.import_interval_sec !== undefined) {
          setSetting("import_interval_sec", String(body.import_interval_sec));
        }
        if (body.show_stream_downloads !== undefined) {
          const v = body.show_stream_downloads === true || body.show_stream_downloads === "1" || body.show_stream_downloads === 1 ? "1" : "0";
          setSetting("show_stream_downloads", v);
        }
        return jsonResponse({ success: true });
      } catch (err) {
        return jsonResponse({ error: "잘못된 요청 형식입니다." }, 400);
      }
    }

    // 9. 정적 파일 서빙
    if (pathname === "/" || pathname === "/index.html") {
      return serveStatic(join(PUBLIC_DIR, "index.html"));
    }
    if (pathname === "/app.js") {
      return serveStatic(join(PUBLIC_DIR, "app.js"));
    }
    if (pathname === "/style.css") {
      return serveStatic(join(PUBLIC_DIR, "style.css"));
    }

    const potentialFile = join(PUBLIC_DIR, pathname.slice(1));
    if (existsSync(potentialFile)) {
      return serveStatic(potentialFile);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`[PlexDashboard] 대시보드 서버 가동 중: http://localhost:${server.port}`);
