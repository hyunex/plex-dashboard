import { describe, expect, test } from "bun:test";
import { parsePlexTimestamp, formatBytes, formatDuration, parseUserAgent, LogParser } from "../log_parser.ts";
import { formatMbps, getBandwidthHistory, getPeakHours, getUserDataConsumption } from "../analytics.ts";
import { isPrivateIp, formatLocation } from "../geoip.ts";
import { BoundedMap } from "../bounded_map.ts";
import { getDashboardStats } from "../database.ts";

describe("1. 포맷터 및 타임스탬프 파서 검증", () => {
  test("parsePlexTimestamp: 표준 Plex 로그 타임스탬프 변환", () => {
    const raw = "Sep 20, 2026 14:35:11.785";
    const parsed = parsePlexTimestamp(raw);
    expect(parsed).toBe("2026-09-20 14:35:11");
  });

  test("formatBytes: 바이트 용량 단위 포맷팅", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1024 * 1024 * 1.5)).toBe("1.50 MB");
    expect(formatBytes(1024 * 1024 * 1024 * 2.5)).toBe("2.50 GB");
  });

  test("formatDuration: 재생 시간 포맷팅", () => {
    expect(formatDuration(0)).toBe("0초");
    expect(formatDuration(45000)).toBe("45초");
    expect(formatDuration(90000)).toBe("1분 30초");
    expect(formatDuration(3665000)).toBe("1시간 1분 5초");
  });

  test("formatMbps: 대역폭 포맷팅", () => {
    expect(formatMbps(0)).toBe("0.00 Mbps");
    expect(formatMbps(12.345)).toBe("12.35 Mbps");
    expect(formatMbps(1500)).toBe("1.50 Gbps");
  });
});

describe("2. BoundedMap (LRU 맵) 상한 및 축출 검증 (F-09)", () => {
  test("지정된 maxSize를 초과하면 가장 오래된 항목이 축출되어야 함", () => {
    const map = new BoundedMap<string, number>(3);
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    expect(map.size).toBe(3);

    // d 추가 시 가장 오래된 a가 축출됨
    map.set("d", 4);
    expect(map.size).toBe(3);
    expect(map.has("a")).toBe(false);
    expect(map.has("b")).toBe(true);
    expect(map.has("d")).toBe(true);

    // b에 접근(get)하면 b가 최신 순위로 이동
    map.get("b");
    map.set("e", 5);
    // 그 다음 가장 오래된 c가 축출되어야 함
    expect(map.has("c")).toBe(false);
    expect(map.has("b")).toBe(true);
    expect(map.has("e")).toBe(true);
  });
});

describe("3. GeoIP 및 사설망 식별 검증 (F-14)", () => {
  test("isPrivateIp: 루프백 및 내부망 IP를 정확히 판별해야 함", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("192.168.1.100")).toBe(true);
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("172.17.0.1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("61.79.170.136")).toBe(false);
  });

  test("formatLocation: GeoIP 정보 깔끔한 포맷팅", () => {
    const loc = formatLocation({
      countryCode: "KR",
      regionName: "Seoul",
      city: "Gangnam-gu",
      isp: "KT",
    });
    expect(loc).toContain("KR");
    expect(loc).toContain("Seoul");
    expect(loc).toContain("KT");
  });
});

describe("4. LogParser 및 기기 식별 검증", () => {
  test("parseUserAgent: 브라우저 및 OS 파싱", () => {
    const p1 = parseUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0");
    expect(p1.platform).toBe("Windows");

    const p2 = parseUserAgent("Dalvik/2.1.0 (Linux; U; Android 14; SM-S928N)");
    expect(p2.platform).toBe("Android");
    expect(p2.device_name).toBe("SM-S928N");
  });

  test("LogParser.parseLine: WebSocket 연결 알림 이벤트 파싱", () => {
    const parser = new LogParser();
    const line = "Sep 20, 2026 14:35:40.287 [266479181275360] DEBUG - Request: [172.30.0.2:56840 (WAN)] GET /:/websockets/notifications (11 live) #3c7f4 GZIP Signed-in Token (testuser) / X-Forwarded-For => 61.43.124.100";
    const act = parser.parseLine(line);
    expect(act).not.toBeNull();
    if (act) {
      expect(act.activity_type).toBe("CONNECT");
      expect(act.user_name).toBe("testuser");
      expect(act.client_ip).toBe("61.43.124.100");
    }
  });
});

describe("5. Analytics 및 통계 엔진 검증 (F-05, F-07)", () => {
  test("getDashboardStats: 통계 객체 반환 및 타입 검증", () => {
    const stats = getDashboardStats();
    expect(typeof stats.total_users).toBe("number");
    expect(typeof stats.active_users_today).toBe("number");
    expect(typeof stats.total_plays).toBe("number");
    expect(stats.total_events).toBeGreaterThanOrEqual(0);
  });

  test("getPeakHours: 24시간 피크 데이터 산출 (SQL 기반)", () => {
    const res = getPeakHours("activity");
    expect(res.hours.length).toBe(24);
    expect(res.summary.peak_hour).toBeGreaterThanOrEqual(0);
    expect(res.summary.peak_hour).toBeLessThan(24);
  });

  test("getUserDataConsumption: 5가지 기간별 데이터 산출", () => {
    for (const range of ["1h", "1d", "1m", "1y", "all"] as const) {
      const res = getUserDataConsumption(range);
      expect(res.range).toBe(range);
      expect(Array.isArray(res.users)).toBe(true);
      expect(typeof res.summary.total_bytes).toBe("number");
    }
  });
});
