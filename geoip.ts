import {
  getUncachedIps,
  setCachedLocation,
  getCachedLocation,
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

/**
 * 내부망/외부망/판별불가 3상태 분류.
 * isPrivateIp는 "Unknown"을 true로 취급하지만, 트래픽 집계에서는 알 수 없는 IP를
 * 내부망으로 몰아넣으면 안 되므로 별도 함수로 분리했다.
 */
export function classifyIpScope(ip: string | null | undefined): "lan" | "wan" | "unknown" {
  if (!ip || ip === "Unknown") return "unknown";
  return isPrivateIp(ip) ? "lan" : "wan";
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

    // ip-api 무료 티어는 HTTPS를 제공하지 않는다. 프라이버시 요구가 있으면 GEOIP_API_URL로
    // HTTPS를 지원하는 제공자(예: 유료 ip-api 플랜, ipwho.is 등)를 주입할 수 있다.
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

