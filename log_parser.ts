import { createHash } from "crypto";
import { resolveMediaByRatingKey, resolveMediaByPartId } from "./plex_metadata.ts";
import { type ActivityInsert, saveDeviceProfile, getDeviceProfile } from "./database.ts";
import { BoundedMap } from "./bounded_map.ts";

const MONTH_MAP: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

export function parsePlexTimestamp(raw: string): string {
  const match = raw.match(/^([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  if (!match) return new Date().toISOString().replace("T", " ").slice(0, 19);
  const [, mStr, dayStr, yearStr, timeStr] = match;
  const month = MONTH_MAP[mStr] ?? "01";
  return `${yearStr}-${month}-${dayStr.padStart(2, "0")} ${timeStr}`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 2 : 0)} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0초";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}시간 ${m}분 ${sec}초`;
  if (m > 0) return `${m}분 ${sec}초`;
  return `${sec}초`;
}

function isValidIp(ip: string): boolean {
  if (!ip) return false;
  return /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip) ||
    /^[0-9a-fA-F:]+$/.test(ip);
}

function isPrivateOrProxyIp(ip: string): boolean {
  if (!ip) return false;
  const clean = ip.replace("::ffff:", "").trim();
  return clean === "127.0.0.1" || clean === "::1" || clean === "localhost" ||
    /^10\./.test(clean) || /^192\.168\./.test(clean) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(clean);
}

interface XplexInfo {
  clientId?: string;
  device?: string;       // X-Plex-Device (모델명: Mobile / Windows / TV)
  deviceName?: string;   // X-Plex-Device-Name (기기명: PC-Name / Phone-Name / Firefox)
  platform?: string;     // X-Plex-Platform (Android / Windows / Firefox)
  product?: string;      // X-Plex-Product (Plezy / Plex Web)
  version?: string;      // X-Plex-Version
}

export function parseXplex(line: string): XplexInfo {
  const get = (key: string): string | undefined => {
    const m = line.match(new RegExp(`${key}\\s*=>\\s*([^/]+?)(?=\\s*/\\s*[A-Za-z-]+\\s*=>|\\s*$)`, "i"));
    const v = m?.[1]?.trim();
    return v && v !== "" ? v : undefined;
  };
  return {
    clientId: get("X-Plex-Client-Identifier"),
    device: get("X-Plex-Device"),
    deviceName: get("X-Plex-Device-Name"),
    platform: get("X-Plex-Platform"),
    product: get("X-Plex-Product"),
    version: get("X-Plex-Version"),
  };
}

/** UA 문자열 → {기기명, 플랫폼, 제품} 정밀 파싱 */
export function parseUserAgent(ua: string): { device_name: string; platform: string; product?: string } {
  const s = ua.trim();
  // Dalvik/2.1.0 (Linux; U; Android ...; Model Build/...) → 기기 모델명, 플랫폼: Android
  let m = s.match(/Dalvik\/[\d.]+ \(Linux; U; Android [\d.]+; ([A-Za-z0-9_-]+)/i);
  if (m) return { device_name: m[1], platform: "Android" };
  // Mozilla/5.0 (Windows NT ...) ... Firefox/156.0 → 기기: Firefox(PC 웹), 플랫폼: Windows
  m = s.match(/Mozilla\/[\d.]+ \(([^;)]+)[^)]*\).*?(Firefox|Chrome|Edg|Safari|OPR)[\/ ]([\d.]+)/i);
  if (m) {
    const os = /Windows/i.test(m[1]) ? "Windows" : /Macintosh|Mac OS/i.test(m[1]) ? "macOS" : m[1];
    return { device_name: `${m[2]} (PC 웹)`, platform: os, product: "Plex Web" };
  }
  // libmpv → MPV 기반 플레이어
  if (/^libmpv/i.test(s)) return { device_name: "MPV 플레이어", platform: "Desktop" };
  // Plex; 버전; OS → Plex 데스크탑 앱
  m = s.match(/^Plex;\s*([^;]+);\s*(.+)$/i);
  if (m) return { device_name: "Plex 데스크탑 앱", platform: m[2].trim(), product: "Plex" };
  // Dart/... (Plezy 모바일 앱의 HTTP 스택) → 단독으론 모호, X-Plex 병합 전 임시값
  if (/^Dart/i.test(s)) return { device_name: "모바일 앱", platform: "Mobile" };
  if (/^Plezy/i.test(s)) return { device_name: "Plezy 앱", platform: "Mobile", product: "Plezy" };
  const first = s.split(" ")[0] || s;
  return { device_name: first.slice(0, 40), platform: "Device" };
}

export interface DeviceProfile {
  clientId?: string;
  device_name: string;
  platform: string;
  product?: string;
  client_version?: string;
}

interface RequestContext {
  reqId: string;
  timestamp: string;
  user_name?: string;
  user_id?: string;
  client_ip?: string;
  clientId?: string;
  device_name?: string;
  platform?: string;
  product?: string;
  client_version?: string;
  method?: string;
  url?: string;
  userAgent?: string;
  hasRange?: boolean;
  ratingKey?: string;
  state?: string;
  time?: number;
  duration?: number;
  partId?: string;
  titleFallback?: string;
  createdAt: number;
}

export class LogParser {
  private activeRequests = new Map<string, RequestContext>();
  private userIpMap = new BoundedMap<string, string>(1000);
  private deviceByClientId = new BoundedMap<string, DeviceProfile>(2000);
  private deviceByUserIp = new BoundedMap<string, DeviceProfile>(2000);
  private lastConnectTime = new BoundedMap<string, number>(1000);
  private recentTimelinePlays = new BoundedMap<string, number>(2000); // F-15: 재생 중 스트리밍 상관분석용
  private cleanupOldRequests() {
    const now = Date.now();
    for (const [key, ctx] of this.activeRequests.entries()) {
      if (now - ctx.createdAt > 10 * 60 * 1000) this.activeRequests.delete(key);
    }
  }

  /** X-Plex + UA를 합쳐 최종 기기 프로필 확정. 기지식과 병합해 빈칸 메움 */
  private buildProfile(x: XplexInfo, ua?: string): DeviceProfile {
    const parsed = ua ? parseUserAgent(ua) : undefined;
    // X-Plex 우선, UA는 보조. 둘 다 없으면 Unknown
    let device_name = x.deviceName || x.device || parsed?.device_name || "알 수 없는 기기";
    let platform = x.platform || parsed?.platform || "Unknown";
    // "Firefox"가 Device-Name/Product로 들어오는 Plex Web 케이스 → PC 웹으로 정규화
    if (device_name === "Firefox" || x.product === "Plex Web") {
      device_name = ua && /Windows/i.test(ua) ? "Firefox (PC 웹)" : "PC 웹 브라우저";
      if (platform === "Firefox") platform = ua && /Windows/i.test(ua) ? "Windows" : "Desktop";
    }
    return {
      clientId: x.clientId,
      device_name,
      platform,
      product: x.product || parsed?.product,
      client_version: x.version,
    };
  }

  private rememberProfile(user: string | undefined, ip: string | undefined, p: DeviceProfile) {
    if (p.clientId) {
      const prev = this.deviceByClientId.get(p.clientId);
      const updated: DeviceProfile = {
        clientId: p.clientId,
        device_name: p.device_name !== "알 수 없는 기기" ? p.device_name : (prev?.device_name ?? p.device_name),
        platform: p.platform !== "Unknown" ? p.platform : (prev?.platform ?? p.platform),
        product: p.product ?? prev?.product,
        client_version: p.client_version ?? prev?.client_version,
      };
      this.deviceByClientId.set(p.clientId, updated);
      // F-10: 기기 프로필을 DB에 영속화하여 서버 재시작 시에도 유지
      if (updated.device_name !== "알 수 없는 기기") {
        try {
          saveDeviceProfile(p.clientId, {
            device_name: updated.device_name,
            platform: updated.platform,
            product: updated.product ?? null,
            client_version: updated.client_version ?? null,
          });
        } catch {}
      }
    }
    if (user && ip) {
      const key = `${user}@${ip}`;
      const prev = this.deviceByUserIp.get(key);
      if (!prev || (p.device_name !== "알 수 없는 기기" && prev.device_name === "알 수 없는 기기")) {
        this.deviceByUserIp.set(key, p);
      }
    }
  }

  /** 요청 컨텍스트에 기지식을 역보정: 동일 clientId/사용자+IP의 최신 프로필로 빈칸 채움 */
  private backfillProfile(ctx: RequestContext) {
    if (ctx.clientId) {
      let known = this.deviceByClientId.get(ctx.clientId);
      // F-10: 인메모리 캐시에 없으면 DB 영속 프로필에서 복원
      if (!known) {
        try {
          const dbProfile = getDeviceProfile(ctx.clientId);
          if (dbProfile) {
            known = {
              clientId: ctx.clientId,
              device_name: dbProfile.device_name,
              platform: dbProfile.platform,
              product: dbProfile.product ?? undefined,
              client_version: dbProfile.client_version ?? undefined,
            };
            this.deviceByClientId.set(ctx.clientId, known);
          }
        } catch {}
      }
      if (known) {
        if (!ctx.device_name || ctx.device_name === "알 수 없는 기기") ctx.device_name = known.device_name;
        if (!ctx.platform || ctx.platform === "Unknown") ctx.platform = known.platform;
        if (!ctx.product) ctx.product = known.product;
        if (!ctx.client_version) ctx.client_version = known.client_version;
      }
    }
    if ((!ctx.device_name || ctx.device_name === "알 수 없는 기기") && ctx.user_name && ctx.client_ip) {
      const known = this.deviceByUserIp.get(`${ctx.user_name}@${ctx.client_ip}`);
      if (known) {
        ctx.device_name = known.device_name;
        ctx.platform = known.platform;
        if (!ctx.product) ctx.product = known.product;
      }
    }
  }

  public parseLine(line: string): ActivityInsert | null {
    if (!line || line.length < 25) return null;
    const timeMatch = line.match(/^([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{2}:\d{2}:\d{2}\.\d{3})/);
    if (!timeMatch) return null;
    const timestamp = parsePlexTimestamp(timeMatch[1]);

    // F-03: Plex 공인 검증 라인을 우선 채택하고 IP 유효성 검증
    const verifiedMatch = line.match(/Using X-Forwarded-For:\s*([0-9a-fA-F:.]+)\s+as remote address/i);
    let detectedIp: string | null = null;
    if (verifiedMatch && isValidIp(verifiedMatch[1].replace("::ffff:", "").trim())) {
      detectedIp = verifiedMatch[1].replace("::ffff:", "").trim();
    }
    const authMatch = line.match(/Auth:\s+authenticated user\s+(\d+)\s+as\s+([^\s]+)/);
    if (authMatch && detectedIp) this.userIpMap.set(authMatch[2], detectedIp);

    if (line.includes("Request: [")) {
      const reqMatch = line.match(/Request:\s*\[([^\]]+)\]\s+([A-Z]+)\s+([^\s]+).*?#([0-9a-f]+)/);
      if (reqMatch) {
        const [, remoteAddr, method, url, reqId] = reqMatch;
        let clientIp = detectedIp;
        if (!clientIp) {
          const remoteIp = (remoteAddr.split(" ")[0] ?? "").split(":")[0]?.replace("::ffff:", "").trim();
          // 신뢰할 수 있는 프록시(로컬/사설망)에서 온 요청일 때만 X-Forwarded-For 수용 (F-03)
          if (isPrivateOrProxyIp(remoteIp)) {
            const xffMatch = line.match(/X-Forwarded-For\s*=>\s*([0-9a-fA-F:.]+)/i);
            if (xffMatch && isValidIp(xffMatch[1].replace("::ffff:", "").trim())) {
              clientIp = xffMatch[1].replace("::ffff:", "").trim();
            }
          }
          if (!clientIp && isValidIp(remoteIp)) {
            clientIp = remoteIp;
          }
        }
        const userMatch = line.match(/Signed-in Token\s*\(([^)]+)\)/);
        const userName = userMatch?.[1]?.trim();
        const uaMatch = line.match(/[Uu]ser-[Aa]gent\s*=>\s*([^/]+(?:\/[^/]+)?(?:\s*\([^)]*\))?)/);
        const userAgent = uaMatch?.[1]?.trim();
        const xplex = parseXplex(line);
        const profile = this.buildProfile(xplex, userAgent);
        if (userName && clientIp) {
          this.userIpMap.set(userName, clientIp);
          this.rememberProfile(userName, clientIp, profile);
        } else if (xplex.clientId) {
          this.rememberProfile(undefined, undefined, profile);
        }

        const ctx: RequestContext = {
          reqId, timestamp, user_name: userName, client_ip: clientIp,
          clientId: xplex.clientId || profile.clientId,
          device_name: profile.device_name, platform: profile.platform,
          product: profile.product, client_version: profile.client_version,
          method, url, userAgent, createdAt: Date.now(),
        };
        ctx.hasRange = /Range\s*=>/i.test(line);

        if (url.includes("/:/timeline") || url.includes("ratingKey=")) {
          const queryStr = url.split("?")[1];
          if (queryStr) {
            const params = new URLSearchParams(queryStr);
            ctx.ratingKey = params.get("ratingKey") || undefined;
            ctx.state = params.get("state") || undefined;
            if (ctx.ratingKey && userName) {
              // F-15: timeline 보고 시점 기록 (재생 중 스트리밍 세션 판별용)
              this.recentTimelinePlays.set(`${userName}@${ctx.ratingKey}`, Date.now());
            }
            const t = params.get("time");
            if (t) ctx.time = parseInt(t, 10);
            const d = params.get("duration");
            if (d) ctx.duration = parseInt(d, 10);
          }
        } else if (url.includes("/library/parts/")) {
          const pm = url.match(/\/library\/parts\/(\d+)\//);
          if (pm) ctx.partId = pm[1];
        }

        this.backfillProfile(ctx);
        this.activeRequests.set(reqId, ctx);
        this.cleanupOldRequests();

        if (url.includes("/:/websockets/notifications") && userName) {
          return this.handleConnectEvent(timestamp, userName, clientIp, ctx);
        }
      }
    }

    const reqDetailMatch = line.match(/\[Req#([0-9a-f]+)\]\s+(.*)/);
    if (reqDetailMatch) {
      const [, reqId, rest] = reqDetailMatch;
      const ctx = this.activeRequests.get(reqId);
      if (ctx) {
        const um = rest.match(/\[Now\]\s+User is\s+([^\s]+)\s*\(ID:\s*(\d+)\)/);
        if (um) { ctx.user_name = um[1]; ctx.user_id = um[2]; }
        const dm = rest.match(/\[Now\]\s+Device is\s+([^\s(]+)(?:\s*\(([^)]+)\))?/);
        if (dm) {
          // [Now]는 구형/웹 클라이언트에서만 나오므로, X-Plex 기지식이 없을 때만 사용
          if (!ctx.device_name || ctx.device_name === "알 수 없는 기기" || ctx.device_name === "모바일 앱") {
            ctx.platform = dm[1].trim();
            ctx.device_name = dm[2]?.trim() || ctx.platform;
          }
          if (ctx.user_name && ctx.client_ip) {
            this.rememberProfile(ctx.user_name, ctx.client_ip, {
              device_name: ctx.device_name ?? "알 수 없는 기기",
              platform: ctx.platform ?? "Unknown",
              product: ctx.product, client_version: ctx.client_version, clientId: ctx.clientId,
            });
          }
        }
        const pp = rest.match(/Play progress on\s+(\d+)\s+'([^']+)'\s+-\s+got played\s+(\d+)\s+ms/);
        if (pp) { ctx.ratingKey = pp[1]; ctx.titleFallback = pp[2]; ctx.time = parseInt(pp[3], 10); }
        const tr = rest.match(/reporting timeline state\s+([a-zA-Z]+),\s+progress of\s+(\d+)\/(\d+)ms.*?ratingKey=(\d+)/);
        if (tr) { ctx.state = tr[1]; ctx.time = parseInt(tr[2], 10); ctx.duration = parseInt(tr[3], 10); ctx.ratingKey = tr[4]; }
        this.backfillProfile(ctx);
      }
    }

    if (line.includes("Completed:") || line.includes("Completed after connection close:")) {
      const compMatch = line.match(/(?:Completed:|Completed after connection close:).*?#([0-9a-f]+)(.*?)$/);
      if (compMatch) {
        const ctx = this.activeRequests.get(compMatch[1]);
        if (ctx) {
          const bytesMatch = compMatch[2].match(/(\d+)\s+bytes/);
          const bytes = bytesMatch ? parseInt(bytesMatch[1], 10) : 0;
          // Completed 라인에도 Range 표기가 있으면 반영
          if (/range:/i.test(compMatch[2])) ctx.hasRange = true;
          this.backfillProfile(ctx);
          const act = this.finalizeRequestEvent(ctx, bytes, timestamp);
          this.activeRequests.delete(compMatch[1]);
          return act;
        }
      }
    }
    return null;
  }

  private handleConnectEvent(timestamp: string, userName: string, clientIp: string | undefined, ctx: RequestContext): ActivityInsert | null {
    const ip = clientIp || this.userIpMap.get(userName) || "Unknown";
    const key = `${userName}:${ip}`;
    const now = Date.now();
    if (now - (this.lastConnectTime.get(key) ?? 0) < 10 * 60 * 1000) return null;
    this.lastConnectTime.set(key, now);
    const hash = createHash("md5").update(`connect:${userName}:${ip}:${timestamp.slice(0, 16)}`).digest("hex");
    const deviceLabel = ctx.product && ctx.product !== ctx.device_name
      ? `${ctx.product} · ${ctx.device_name}` : (ctx.device_name ?? "알 수 없는 기기");
    return {
      event_hash: hash, timestamp, user_name: userName, user_id: null, client_ip: ip,
      device_name: ctx.device_name, platform: ctx.platform, activity_type: "CONNECT",
      media_id: null, show_title: null, season_index: null, episode_index: null,
      episode_title: null, media_title: null, media_type: null,
      progress_ms: 0, duration_ms: 0, file_size_bytes: 0,
      client_id: ctx.clientId ?? null, product: ctx.product ?? null,
      client_version: ctx.client_version ?? null, ip_location: null, is_stream: 0,
      raw_summary: `[${userName}]님이 ${deviceLabel}(${ip})에서 서버에 접속했습니다.`,
    };
  }

  private finalizeRequestEvent(ctx: RequestContext, bytes: number, completedTimestamp: string): ActivityInsert | null {
    const userName = ctx.user_name;
    if (!userName) return null;
    const ip = ctx.client_ip || this.userIpMap.get(userName) || "Unknown";
    const deviceLabel = ctx.product && ctx.product !== ctx.device_name
      ? `${ctx.product} · ${ctx.device_name}` : (ctx.device_name ?? "알 수 없는 기기");
    const platform = ctx.platform ?? "Unknown";

    if (ctx.ratingKey && ctx.state) {
      const meta = resolveMediaByRatingKey(ctx.ratingKey, ctx.titleFallback);
      const progress = ctx.time ?? 0;
      const duration = ctx.duration ?? 0;
      let activityType = "PLAYING";
      if (ctx.state.toLowerCase() === "paused") activityType = "PAUSE";
      else if (ctx.state.toLowerCase() === "stopped") activityType = "STOP";
      else if (progress <= 5000) activityType = "PLAY_START";
      const pct = duration > 0 ? Math.round((progress / duration) * 100) : 0;
      const quant = Math.floor(progress / 30000);
      const hash = createHash("md5")
        .update(`timeline:${userName}:${ctx.ratingKey}:${activityType}:${quant}:${ctx.timestamp.slice(0, 16)}`).digest("hex");
      const actionKo = activityType === "PLAY_START" ? "시청을 시작" : activityType === "PAUSE" ? "시청을 일시정지" : activityType === "STOP" ? "시청을 종료" : "시청 중";
      const progKo = activityType === "PLAYING" || activityType === "STOP"
        ? ` (${formatDuration(progress)} / ${formatDuration(duration)}, ${pct}%)` : activityType === "PAUSE" ? ` (${formatDuration(progress)})` : "";
      return {
        event_hash: hash, timestamp: ctx.timestamp || completedTimestamp,
        user_name: userName, user_id: ctx.user_id, client_ip: ip,
        device_name: ctx.device_name, platform, activity_type: activityType,
        media_id: meta.rating_key, show_title: meta.show_title, season_index: meta.season_index,
        episode_index: meta.episode_index, episode_title: meta.episode_title,
        media_title: meta.media_title, media_type: meta.media_type,
        progress_ms: progress, duration_ms: duration, file_size_bytes: bytes,
        client_id: ctx.clientId ?? null, product: ctx.product ?? null,
        client_version: ctx.client_version ?? null, ip_location: null, is_stream: 0,
        raw_summary: `[${userName}]님이 ${deviceLabel}(${ip})에서 '${meta.media_title}' ${actionKo}했습니다.${progKo}`,
      };
    }

    if (ctx.partId && bytes > 5 * 1024 * 1024) {
      const meta = resolveMediaByPartId(ctx.partId);
      const mediaTitle = meta?.media_title || `미디어 파트 #${ctx.partId}`;
      // F-15: 스트리밍 판정 - Range 헤더 분할 전송이거나, 최근 5분 이내 해당 영상 timeline 보고가 있었던 경우 스트리밍으로 판정
      const hasRecentPlay = meta?.rating_key && (Date.now() - (this.recentTimelinePlays.get(`${userName}@${meta.rating_key}`) ?? 0) < 5 * 60 * 1000);
      const isStream = ctx.hasRange || hasRecentPlay ? 1 : 0;
      const hash = createHash("md5")
        .update(`download:${userName}:${ctx.partId}:${Math.floor(bytes / 10000000)}:${ctx.timestamp.slice(0, 16)}:${isStream}`).digest("hex");
      const kindKo = isStream ? "재생 중 스트리밍 전송" : "오프라인용 다운로드";
      return {
        event_hash: hash, timestamp: ctx.timestamp || completedTimestamp,
        user_name: userName, user_id: ctx.user_id, client_ip: ip,
        device_name: ctx.device_name, platform, activity_type: "DOWNLOAD",
        media_id: meta?.rating_key || ctx.partId, show_title: meta?.show_title,
        season_index: meta?.season_index, episode_index: meta?.episode_index,
        episode_title: meta?.episode_title, media_title: mediaTitle,
        media_type: meta?.media_type || "other",
        progress_ms: 0, duration_ms: 0, file_size_bytes: bytes,
        client_id: ctx.clientId ?? null, product: ctx.product ?? null,
        client_version: ctx.client_version ?? null, ip_location: null, is_stream: isStream,
        raw_summary: `[${userName}]님이 ${deviceLabel}(${ip})에서 '${mediaTitle}' ${kindKo}했습니다. (${formatBytes(bytes)})`,
      };
    }
    return null;
  }
}
