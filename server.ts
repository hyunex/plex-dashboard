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
  getBandwidthHistory,
  getPeakHours,
  getTop10PlayedContent,
  getMonthlyUserConsumption,
  getUserDataConsumption,
  getPosterResponse,
  getPlexMachineIdentifier,
} from "./analytics.ts";
import {
  getAvailableLogGroups,
  readUnifiedLogLines,
  LogCollector,
} from "./log_collector.ts";
import { lookupIpsBatch } from "./geoip.ts";

const PORT = parseInt(process.env.PORT || getSetting("port", "32420"), 10);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = join(import.meta.dir, "public");

// 주기적 로그 수집기 시작
const importIntervalSec = parseInt(getSetting("import_interval_sec", "30"), 10);
const collector = new LogCollector(importIntervalSec);
collector.start();

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host") || "";
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host || originHost.startsWith("localhost") || originHost.startsWith("127.0.0.1")) {
        return {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Vary": "Origin",
        };
      }
    } catch {}
  }
  return {};
}

function isCsrfSafe(req: Request): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host");
  if (!origin && !referer) return true; // cURL / 내부 툴
  const target = origin || referer;
  if (!target || !host) return true;
  try {
    const targetHost = new URL(target).host;
    return targetHost === host || targetHost.startsWith("localhost") || targetHost.startsWith("127.0.0.1");
  } catch {
    return false;
  }
}

function jsonResponse(data: unknown, status = 200, req?: Request): Response {
  const cors = req ? getCorsHeaders(req) : {};
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS,
      ...cors,
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
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (req.method === "OPTIONS") {
      const cors = getCorsHeaders(req);
      return new Response(null, { status: 204, headers: cors });
    }

    // 0. 헬스체크 엔드포인트
    if (pathname === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
      return jsonResponse({
        status: "ok",
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      }, 200, req);
    }

    // 1. 활동 내역 조회 API (입력값 정밀 클램프 적용)
    if (pathname === "/api/activities" && req.method === "GET") {
      const user = url.searchParams.get("user") || undefined;
      const type = url.searchParams.get("type") || undefined;
      const parsedLimit = parseInt(url.searchParams.get("limit") || "50", 10);
      const limit = Math.min(Math.max(1, isNaN(parsedLimit) ? 50 : parsedLimit), 500);
      const parsedOffset = parseInt(url.searchParams.get("offset") || "0", 10);
      const offset = Math.max(0, isNaN(parsedOffset) ? 0 : parsedOffset);
      const hideStream = url.searchParams.get("hideStream") === "1" || getSetting("show_stream_downloads", "1") === "0";
      const res = getActivities({ user, type, limit, offset, hideStream });
      return jsonResponse(res, 200, req);
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
      if (!isCsrfSafe(req)) return jsonResponse({ error: "CSRF check failed" }, 403, req);
      try {
        const body = (await req.json()) as { user_name?: string; alias?: string };
        if (!body.user_name) return jsonResponse({ error: "user_name이 필요합니다." }, 400, req);
        setAlias(body.user_name, body.alias ?? "");
        return jsonResponse({ success: true }, 200, req);
      } catch (err) {
        return jsonResponse({ error: "잘못된 요청 형식입니다." }, 400, req);
      }
    }

    // 3. 통계 API
    if (pathname === "/api/stats" && req.method === "GET") {
      const stats = getDashboardStats();
      return jsonResponse(stats);
    }
    // 3-1. 대역폭 이력 통계 API (1h / 3h / 6h / 24h)
    if (pathname === "/api/analytics/bandwidth" && req.method === "GET") {
      const rawRange = url.searchParams.get("range") || "1h";
      const range = (rawRange === "3h" || rawRange === "6h" || rawRange === "24h") ? rawRange : "1h";
      const data = getBandwidthHistory(range);
      return jsonResponse(data);
    }

    // 3-2. 시간대별 피크 타임 API (00시 ~ 23시)
    if (pathname === "/api/analytics/peak-hours" && req.method === "GET") {
      const rawSource = url.searchParams.get("source");
      const source = rawSource === "views30d" ? "views30d" : "activity";
      const data = getPeakHours(source);
      return jsonResponse(data);
    }

    // 3-3. 최근 30일간 최다 재생 콘텐츠 Top 10 API
    if (pathname === "/api/analytics/top-content" && req.method === "GET") {
      const data = getTop10PlayedContent();
      return jsonResponse(data);
    }

    // 3-4. 사용자별 추정 데이터 사용량 API (1h / 1d / 1m / 1y / all)
    if ((pathname === "/api/analytics/user-consumption" || pathname === "/api/analytics/monthly-users") && req.method === "GET") {
      const userRange = url.searchParams.get("range") || "1m";
      const data = getUserDataConsumption(userRange);
      return jsonResponse(data);
    }

    // 3-5. 분석 대시보드 전체 일괄 조회 API
    if (pathname === "/api/analytics/all" && req.method === "GET") {
      const rawRange = url.searchParams.get("range") || "1h";
      const range = (rawRange === "3h" || rawRange === "6h" || rawRange === "24h") ? rawRange : "1h";
      const rawSource = url.searchParams.get("source");
      const source = rawSource === "views30d" ? "views30d" : "activity";
      const rawUserRange = url.searchParams.get("userRange") || "1m";
      return jsonResponse({
        bandwidth: getBandwidthHistory(range),
        peakHours: getPeakHours(source),
        topContent: getTop10PlayedContent(),
        monthlyUsers: getUserDataConsumption(rawUserRange),
      });
    }
    // 3-6. 포스터 썸네일 스트리밍 / 리다이렉트 API
    if (pathname === "/api/poster" && (req.method === "GET" || req.method === "HEAD")) {
      const ratingKey = url.searchParams.get("ratingKey");
      if (!ratingKey || !/^\d+$/.test(ratingKey)) {
        return new Response("Invalid ratingKey", { status: 400 });
      }
      return await getPosterResponse(ratingKey);
    }
    // 3-7. Plex 서버 정보 API (웹 앱 링크용)
    if (pathname === "/api/plex-server-info" && (req.method === "GET" || req.method === "HEAD")) {
      const machineId = getPlexMachineIdentifier();
      return jsonResponse({
        machineIdentifier: machineId,
        webBaseUrl: `https://app.plex.tv/desktop/#!/server/${machineId}/details?key=%2Flibrary%2Fmetadata%2F`,
      });
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
      if (!isCsrfSafe(req)) return jsonResponse({ error: "CSRF check failed" }, 403, req);
      const res = await collector.runImport();
      return jsonResponse({ success: true, importedCount: res.importedCount }, 200, req);
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
      if (!isCsrfSafe(req)) return jsonResponse({ error: "CSRF check failed" }, 403, req);
      try {
        const body = (await req.json()) as { ips?: string[] };
        const safeIps = Array.isArray(body.ips) ? body.ips.slice(0, 100) : [];
        const locMap = await lookupIpsBatch(safeIps);
        return jsonResponse(locMap, 200, req);
      } catch {
        return jsonResponse({ error: "위치 조회 실패" }, 400, req);
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

// 정상 종료 신호 핸들러 (F-13)
let isShuttingDown = false;
function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[PlexDashboard] ${signal} 신호 수신, 정상 종료를 진행합니다...`);
  try {
    collector.stop();
    server.stop();
  } catch (err) {
    console.error("[PlexDashboard] 종료 처리 중 오류:", err);
  }
  process.exit(0);
}
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

console.log(`[PlexDashboard] 대시보드 서버 가동 중: http://localhost:${server.port}`);
