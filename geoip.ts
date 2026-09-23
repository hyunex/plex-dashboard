import {
  getUncachedIps,
  setCachedLocation,
  getCachedLocation,
  db,
} from "./database.ts";

interface IpApiBatchItem {
  query: string;
  status: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  isp?: string;
}

function cleanField(val?: string): string {
  if (!val) return "";
  return val.replace(/[<>'"`;\\]/g, "").trim();
}

export function formatLocation(item: { countryCode?: string; regionName?: string; city?: string; isp?: string }): string {
  const parts: string[] = [];
  const country = cleanField(item.countryCode);
  const regionName = cleanField(item.regionName);
  const city = cleanField(item.city);
  const isp = cleanField(item.isp);

  if (country) parts.push(country);
  const region = [regionName, city].filter(Boolean).join(" ");
  if (region) parts.push(region);
  let loc = parts.join(" · ");
  if (isp) loc += loc ? ` (${isp})` : isp;
  return loc;
}

/** 사설/루프백/CGNAT/링크로컬 IP 판별 (외부 조회 제외) */
export function isPrivateIp(ip: string): boolean {
  if (!ip || ip === "Unknown") return true;
  if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true; // CGNAT (RFC 6598)
  if (/^169\.254\./.test(ip)) return true; // Link-local
  if (/^(fc|fd)[0-9a-f:]*/i.test(ip)) return true;
  return false;
}

let lastBatchCall = 0;
const MIN_BATCH_INTERVAL_MS = 2000; // 분당 최대 30회로 엄격 제한 (F-14: ip-api 무료 한도 45회 초과 차단 방지)

/** 배치 조회 (최대 100개, 스로틀 적용) */
export async function lookupIpsBatch(ips: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const targets = [...new Set(ips)].filter((ip) => !isPrivateIp(ip));
  if (targets.length === 0) return result;
  const uncached = getUncachedIps(targets);
  if (uncached.length === 0) {
    for (const ip of targets) {
      const loc = getCachedLocation(ip);
      if (loc) result[ip] = loc;
    }
    return result;
  }
  try {
    // 스로틀: 직전 호출과 최소 2초 간격 보장
    const now = Date.now();
    const elapsed = now - lastBatchCall;
    if (elapsed < MIN_BATCH_INTERVAL_MS) {
      await Bun.sleep(MIN_BATCH_INTERVAL_MS - elapsed);
    }
    lastBatchCall = Date.now();

    const endpoint = process.env.GEOIP_API_URL || "http://ip-api.com/batch?fields=status,countryCode,regionName,city,isp,query";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(uncached.slice(0, 100)),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`ip-api batch failed: ${res.status}`);
    const items = (await res.json()) as IpApiBatchItem[];
    for (const item of items) {
      if (item.status === "success" && item.query) {
        const loc = formatLocation(item);
        if (loc) {
          setCachedLocation(item.query, loc);
          result[item.query] = loc;
        }
      }
    }
  } catch (err) {
    console.error("[GeoIP] 배치 조회 실패:", err);
  }
  for (const ip of targets) {
    if (!result[ip]) {
      const loc = getCachedLocation(ip);
      if (loc) result[ip] = loc;
    }
  }
  return result;
}

/** 수집 시점: 신규 이벤트의 IP 위치를 캐시에서 즉시 메우고, 미보유분은 배치 조회 후 DB 역보정 */
export async function backfillActivityLocations(limit = 200): Promise<number> {
  const rows = db.query(
    `SELECT DISTINCT client_ip FROM activity_logs
     WHERE (ip_location IS NULL OR ip_location = '') AND client_ip IS NOT NULL AND client_ip != '' AND client_ip != 'Unknown'
     ORDER BY id DESC LIMIT ?`
  ).all(limit) as unknown as { client_ip: string }[];
  const ips = rows.map((r) => r.client_ip);
  if (ips.length === 0) return 0;
  const locMap = await lookupIpsBatch(ips);
  let updated = 0;
  for (const [ip, loc] of Object.entries(locMap)) {
    const r = db.run(`UPDATE activity_logs SET ip_location = ? WHERE (ip_location IS NULL OR ip_location = '') AND client_ip = ?`, [loc, ip]);
    updated += r.changes as number;
  }
  return updated;
}
