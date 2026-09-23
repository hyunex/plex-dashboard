import { db, getAliases } from "./database.ts";
import { plexDb } from "./plex_db.ts";
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 2 : 1)} ${units[i]}`;
}

export function formatMbps(mbps: number): string {
  if (mbps < 0.01) return "0.00 Mbps";
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`;
  return `${mbps.toFixed(2)} Mbps`;
}

// 1. 대역폭 이력 차트 데이터 (1h / 3h / 6h / 24h)
export interface BandwidthPoint {
  time_label: string; // e.g. "20:45" or "09/23 20:45"
  total_bytes: number;
  total_mbps: number;
  lan_bytes: number;
  lan_mbps: number;
  wan_bytes: number;
  wan_mbps: number;
}

export interface BandwidthHistoryResult {
  range: "1h" | "3h" | "6h" | "24h";
  summary: {
    current_mbps: number;
    peak_mbps: number;
    avg_mbps: number;
    total_bytes: number;
    total_bytes_formatted: string;
    lan_bytes: number;
    lan_bytes_formatted: string;
    wan_bytes: number;
    wan_bytes_formatted: string;
  };
  points: BandwidthPoint[];
}

export function getBandwidthHistory(range: "1h" | "3h" | "6h" | "24h"): BandwidthHistoryResult {
  let minutes = 60;
  let bucketMinutes = 1;
  let sqlInterval = "-1 hour";

  if (range === "3h") {
    minutes = 180;
    bucketMinutes = 3;
    sqlInterval = "-3 hours";
  } else if (range === "6h") {
    minutes = 360;
    bucketMinutes = 5;
    sqlInterval = "-6 hours";
  } else if (range === "24h") {
    minutes = 1440;
    bucketMinutes = 15;
    sqlInterval = "-24 hours";
  }

  const bucketSeconds = bucketMinutes * 60;

  // DB에서 구간 내 데이터 추출
  const rows = db.query(`
    SELECT
      timestamp,
      file_size_bytes,
      client_ip
    FROM activity_logs
    WHERE timestamp >= datetime('now', 'localtime', ?) AND file_size_bytes > 0
    ORDER BY timestamp ASC
  `).all(sqlInterval) as Array<{ timestamp: string; file_size_bytes: number; client_ip: string | null }>;

  // 시간 슬롯 버킷 초기화 (균등한 시계열 생성)
  const now = new Date();
  const bucketCount = Math.ceil(minutes / bucketMinutes);
  const buckets: Map<number, { lan: number; wan: number; total: number }> = new Map();

  // now 기준으로 과거 bucketCount개의 버킷 생성
  const bucketStartTimes: Date[] = [];
  const msInBucket = bucketMinutes * 60 * 1000;
  const currentBucketKey = Math.floor(now.getTime() / msInBucket) * msInBucket;

  for (let i = bucketCount - 1; i >= 0; i--) {
    const key = currentBucketKey - i * msInBucket;
    buckets.set(key, { lan: 0, wan: 0, total: 0 });
    bucketStartTimes.push(new Date(key));
  }

  // 데이터 각 버킷에 할당
  for (const r of rows) {
    // timestamp: "YYYY-MM-DD HH:MM:SS"
    const t = new Date(r.timestamp.replace(" ", "T")).getTime();
    if (isNaN(t)) continue;
    const key = Math.floor(t / msInBucket) * msInBucket;
    const b = buckets.get(key);
    if (b) {
      const bytes = r.file_size_bytes;
      b.total += bytes;
      const ip = r.client_ip || "";
      const isLan =
        ip.startsWith("192.168.") ||
        ip.startsWith("10.") ||
        ip.startsWith("172.") ||
        ip.startsWith("127.");
      if (isLan) {
        b.lan += bytes;
      } else {
        b.wan += bytes;
      }
    }
  }

  let peakMbps = 0;
  let totalBytes = 0;
  let lanBytes = 0;
  let wanBytes = 0;
  const points: BandwidthPoint[] = [];

  for (const t of bucketStartTimes) {
    const key = t.getTime();
    const data = buckets.get(key) || { lan: 0, wan: 0, total: 0 };
    totalBytes += data.total;
    lanBytes += data.lan;
    wanBytes += data.wan;

    // Mbps = (bytes * 8) / (bucketSeconds * 1,000,000)
    const totalMbps = Number(((data.total * 8) / (bucketSeconds * 1000000)).toFixed(2));
    const lanMbps = Number(((data.lan * 8) / (bucketSeconds * 1000000)).toFixed(2));
    const wanMbps = Number(((data.wan * 8) / (bucketSeconds * 1000000)).toFixed(2));

    if (totalMbps > peakMbps) peakMbps = totalMbps;

    let timeLabel = "";
    if (range === "24h") {
      const m = String(t.getMonth() + 1).padStart(2, "0");
      const d = String(t.getDate()).padStart(2, "0");
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      timeLabel = `${m}/${d} ${hh}:${mm}`;
    } else {
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      timeLabel = `${hh}:${mm}`;
    }

    points.push({
      time_label: timeLabel,
      total_bytes: data.total,
      total_mbps: totalMbps,
      lan_bytes: data.lan,
      lan_mbps: lanMbps,
      wan_bytes: data.wan,
      wan_mbps: wanMbps,
    });
  }

  const currentMbps = points.length > 0 ? points[points.length - 1].total_mbps : 0;
  const avgMbps = points.length > 0
    ? Number(((totalBytes * 8) / (minutes * 60 * 1000000)).toFixed(2))
    : 0;

  return {
    range,
    summary: {
      current_mbps: currentMbps,
      peak_mbps: peakMbps,
      avg_mbps: avgMbps,
      total_bytes: totalBytes,
      total_bytes_formatted: formatBytes(totalBytes),
      lan_bytes: lanBytes,
      lan_bytes_formatted: formatBytes(lanBytes),
      wan_bytes: wanBytes,
      wan_bytes_formatted: formatBytes(wanBytes),
    },
    points,
  };
}

// 2. 시간대별 피크 타임 바 차트 (00시 ~ 23시)
export interface PeakHourItem {
  hour: number;
  hour_label: string; // "00시", "01시", ...
  total_count: number;
  play_count: number;
  user_count: number;
  total_bytes: number;
  total_bytes_formatted: string;
  is_peak: boolean;
}

export interface PeakHoursResult {
  source: "activity" | "views30d";
  summary: {
    peak_hour: number;
    peak_hour_label: string;
    peak_count: number;
    busiest_window: string;
    quietest_window: string;
    total_samples: number;
  };
  hours: PeakHourItem[];
}

// 피크 시간대 결과 TTL 캐시 (60초)
let cachedPeakHours: { [key: string]: { timestamp: number; data: PeakHoursResult } } = {};

export function getPeakHours(source: "activity" | "views30d" = "activity"): PeakHoursResult {
  const now = Date.now();
  if (cachedPeakHours[source] && now - cachedPeakHours[source].timestamp < 60000) {
    return cachedPeakHours[source].data;
  }

  const hourMap: Map<number, { total: number; plays: number; userCount: number; bytes: number }> = new Map();
  for (let h = 0; h < 24; h++) {
    hourMap.set(h, { total: 0, plays: 0, userCount: 0, bytes: 0 });
  }

  let totalSamples = 0;

  if (source === "views30d" && plexDb) {
    try {
      const rows = plexDb.query(`
        SELECT
          CAST(strftime('%H', datetime(viewed_at, 'unixepoch', 'localtime')) AS INTEGER) as hour,
          COUNT(*) as cnt,
          COUNT(DISTINCT account_id) as users
        FROM metadata_item_views
        WHERE viewed_at >= strftime('%s', 'now', '-30 days')
        GROUP BY hour
      `).all() as Array<{ hour: number; cnt: number; users: number }>;

      for (const r of rows) {
        const item = hourMap.get(r.hour);
        if (item) {
          item.total += r.cnt;
          item.plays += r.cnt;
          item.userCount = r.users;
          totalSamples += r.cnt;
        }
      }
    } catch (err) {
      console.error("[Analytics] 30일 시청 기록 피크 조회 실패:", err);
    }
  } else {
    // 기본값: SQL GROUP BY로 SQLite 엔진에서 집계 (F-05 성능 최적화)
    const rows = db.query(`
      SELECT
        CAST(strftime('%H', timestamp) AS INTEGER) as hour,
        COUNT(*) as total_count,
        SUM(CASE WHEN activity_type LIKE 'PLAY%' THEN 1 ELSE 0 END) as play_count,
        COUNT(DISTINCT user_name) as user_count,
        COALESCE(SUM(file_size_bytes), 0) as total_bytes
      FROM activity_logs
      GROUP BY hour
    `).all() as Array<{ hour: number; total_count: number; play_count: number; user_count: number; total_bytes: number }>;

    for (const r of rows) {
      const item = hourMap.get(r.hour);
      if (item) {
        item.total = r.total_count;
        item.plays = r.play_count;
        item.userCount = r.user_count;
        item.bytes = r.total_bytes;
        totalSamples += r.total_count;
      }
    }
  }
  // 상위 피크 시간대 판정
  const sortedByTotal = [...hourMap.entries()].sort((a, b) => b[1].total - a[1].total);
  const peakHour = sortedByTotal[0]?.[0] ?? 20;
  const peakCount = sortedByTotal[0]?.[1].total ?? 0;
  const top3Hours = new Set(sortedByTotal.slice(0, 3).map((e) => e[0]));

  // 연속된 3시간 창 중 가장 붐비는 구간과 한적한 구간 계산
  let maxWindowSum = -1;
  let maxWindowStart = 0;
  let minWindowSum = Infinity;
  let minWindowStart = 0;

  for (let h = 0; h < 24; h++) {
    const sum = (hourMap.get(h)?.total || 0) + (hourMap.get((h + 1) % 24)?.total || 0) + (hourMap.get((h + 2) % 24)?.total || 0);
    if (sum > maxWindowSum) {
      maxWindowSum = sum;
      maxWindowStart = h;
    }
    if (sum < minWindowSum) {
      minWindowSum = sum;
      minWindowStart = h;
    }
  }

  const hours: PeakHourItem[] = [];
  for (let h = 0; h < 24; h++) {
    const data = hourMap.get(h)!;
    hours.push({
      hour: h,
      hour_label: `${String(h).padStart(2, "0")}시`,
      total_count: data.total,
      play_count: data.plays,
      user_count: data.userCount,
      total_bytes: data.bytes,
      total_bytes_formatted: formatBytes(data.bytes),
      is_peak: top3Hours.has(h),
    });
  }

  const formatWindow = (start: number) => `${String(start).padStart(2, "0")}시 ~ ${String((start + 3) % 24).padStart(2, "0")}시`;
  const result: PeakHoursResult = {
    source,
    summary: {
      peak_hour: peakHour,
      peak_hour_label: `${String(peakHour).padStart(2, "0")}시`,
      peak_count: peakCount,
      busiest_window: formatWindow(maxWindowStart),
      quietest_window: formatWindow(minWindowStart),
      total_samples: totalSamples,
    },
    hours,
  };
  cachedPeakHours[source] = { timestamp: now, data: result };
  return result;
}

// Plex 서버 머신 식별자 및 공식 웹 URL 헬퍼
let plexMachineIdentifier = "19b98de608795fd38dc942ab99885d7335d4e77a";

export async function initPlexServerInfo(): Promise<string> {
  try {
    const res = await fetch("http://127.0.0.1:32400/identity");
    if (res.ok) {
      const xml = await res.text();
      const match = xml.match(/machineIdentifier="([^"]+)"/);
      if (match) {
        plexMachineIdentifier = match[1];
      }
    }
  } catch {}
  return plexMachineIdentifier;
}
initPlexServerInfo();

export function getPlexMachineIdentifier(): string {
  return plexMachineIdentifier;
}

export function makePlexMediaUrl(ratingKey: number | string | null | undefined): string | null {
  if (!ratingKey) return null;
  return `https://app.plex.tv/desktop/#!/server/${plexMachineIdentifier}/details?key=%2Flibrary%2Fmetadata%2F${ratingKey}`;
}

export async function getPosterResponse(ratingKey: string): Promise<Response> {
  const token = process.env.PLEX_TOKEN || "";
  if (plexDb) {
    try {
      // 쇼/에피소드의 경우 에피소드 썸네일(스틸컷)은 완전히 배제하고, 최소 시즌 포스터 또는 쇼 대표 포스터만 탐색
      const row = plexDb.query(`
        SELECT
          item.metadata_type,
          CASE
            -- 영화(1) 또는 쇼 자체(2): 메타데이터 포스터 사용
            WHEN item.metadata_type IN (1, 2) THEN item.user_thumb_url
            -- 에피소드(4): 에피소드 스크린샷은 절대 배제하고, 시즌 포스터 -> 쇼 대표 포스터 -> 쇼 팬아트 순으로만 탐색
            WHEN item.metadata_type = 4 THEN COALESCE(
              NULLIF((SELECT s.user_thumb_url FROM metadata_items s WHERE s.id = item.parent_id AND s.user_thumb_url LIKE 'http%'), ''),
              NULLIF((SELECT show.user_thumb_url FROM metadata_items s JOIN metadata_items show ON s.parent_id = show.id WHERE s.id = item.parent_id AND show.user_thumb_url LIKE 'http%'), ''),
              NULLIF((SELECT show.user_art_url FROM metadata_items s JOIN metadata_items show ON s.parent_id = show.id WHERE s.id = item.parent_id AND show.user_art_url LIKE 'http%'), '')
            )
            WHEN item.metadata_type = 3 THEN COALESCE(
              NULLIF(item.user_thumb_url, ''),
              NULLIF((SELECT show.user_thumb_url FROM metadata_items show WHERE show.id = item.parent_id AND show.user_thumb_url LIKE 'http%'), ''),
              NULLIF((SELECT show.user_art_url FROM metadata_items show WHERE show.id = item.parent_id AND show.user_art_url LIKE 'http%'), '')
            )
            ELSE item.user_thumb_url
          END as poster_url,
          -- 트랜스코딩 폴백용 상위 ID (에피소드면 에피소드 대신 시즌ID -> 쇼ID만 사용)
          CASE
            WHEN item.metadata_type = 4 THEN (SELECT s.id FROM metadata_items s WHERE s.id = item.parent_id)
            ELSE item.id
          END as season_id,
          CASE
            WHEN item.metadata_type = 4 THEN (SELECT show.id FROM metadata_items s JOIN metadata_items show ON s.parent_id = show.id WHERE s.id = item.parent_id)
            WHEN item.metadata_type = 3 THEN item.parent_id
            ELSE item.id
          END as show_id
        FROM metadata_items item
        WHERE item.id = ?
      `).get(ratingKey) as {
        metadata_type: number;
        poster_url: string | null;
        season_id: number | null;
        show_id: number | null;
      } | null;

      if (row?.poster_url && (row.poster_url.startsWith("http://") || row.poster_url.startsWith("https://"))) {
        return Response.redirect(row.poster_url, 302);
      }

      // 외부 HTTP URL이 없으면 로컬 Plex photo transcode 시도
      // 에피소드(4)인 경우 에피소드 썸네일은 배제하고, 시즌 또는 쇼의 thumb을 호출!
      const tryKeys: string[] = [];
      if (row?.metadata_type === 4) {
        if (row.season_id) tryKeys.push(String(row.season_id));
        if (row.show_id) tryKeys.push(String(row.show_id));
      } else if (row?.metadata_type === 3) {
        tryKeys.push(String(row.season_id));
        if (row.show_id) tryKeys.push(String(row.show_id));
      } else {
        tryKeys.push(ratingKey);
      }

      for (const k of tryKeys) {
        const photoUrl = `http://127.0.0.1:32400/photo/:/transcode?width=300&height=450&minSize=1&upscale=1&url=%2Flibrary%2Fmetadata%2F${k}%2Fthumb`;
        const res = await fetch(photoUrl, {
          headers: { "X-Plex-Token": token },
        });
        if (res.ok) {
          return new Response(res.body, {
            headers: {
              "Content-Type": res.headers.get("content-type") || "image/jpeg",
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
      }
    } catch (err) {
      console.error("[Poster] 포스터 조회 오류:", err);
    }
  }

  // 기본 Plex transcode 시도 (영화 등)
  try {
    const photoUrl = `http://127.0.0.1:32400/photo/:/transcode?width=300&height=450&minSize=1&upscale=1&url=%2Flibrary%2Fmetadata%2F${ratingKey}%2Fthumb`;
    const res = await fetch(photoUrl, { headers: { "X-Plex-Token": token } });
    if (res.ok) {
      return new Response(res.body, {
        headers: {
          "Content-Type": res.headers.get("content-type") || "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
  } catch {}

  return new Response("Poster Not Found", { status: 404 });
}

// 3. 최근 30일간 최다 재생 콘텐츠 Top 10
export interface TopContentItem {
  rank: number;
  title: string;
  metadata_type: number;
  type_label: string; // "드라마/시리즈" | "영화" | "음악" | "기타"
  play_count: number;
  viewer_count: number;
  last_played_at: string;
  thumb_url: string | null;
  rating_key: number | string | null;
  plex_url: string | null;
  percentage: number; // 1위 대비 비율 (0 ~ 100)
}
let cachedTop10: { timestamp: number; data: TopContentItem[] } | null = null;

export function getTop10PlayedContent(): TopContentItem[] {
  const now = Date.now();
  if (cachedTop10 && now - cachedTop10.timestamp < 180000) {
    return cachedTop10.data;
  }
  if (!plexDb) {
    // 폴백: activity_logs에서 집계
    const rows = db.query(`
      SELECT
        COALESCE(show_title, media_title) as title,
        media_type,
        MAX(media_id) as rating_key,
        COUNT(*) as play_count,
        COUNT(DISTINCT user_name) as viewer_count,
        MAX(timestamp) as last_played_at
      FROM activity_logs
      WHERE activity_type IN ('PLAY_START', 'PLAYING') AND media_title IS NOT NULL
      GROUP BY COALESCE(show_title, media_title)
      ORDER BY play_count DESC
      LIMIT 10
    `).all() as Array<{ title: string; media_type: string; rating_key: string | null; play_count: number; viewer_count: number; last_played_at: string }>;

    const maxCount = rows[0]?.play_count || 1;
    return rows.map((r, idx) => ({
      rank: idx + 1,
      title: r.title,
      metadata_type: r.media_type === "movie" ? 1 : 4,
      type_label: r.media_type === "movie" ? "영화" : "드라마/시리즈",
      play_count: r.play_count,
      viewer_count: r.viewer_count,
      last_played_at: r.last_played_at,
      thumb_url: r.rating_key ? `/api/poster?ratingKey=${r.rating_key}` : null,
      rating_key: r.rating_key,
      plex_url: makePlexMediaUrl(r.rating_key),
      percentage: Math.round((r.play_count / maxCount) * 100),
    }));
  }

  try {
    // 시즌 포스터가 없다면 쇼 포스터, 쇼 포스터가 없다면 팬아트 등 계층적 대체 포스터 탐색
    const rows = plexDb.query(`
      SELECT
        COALESCE(NULLIF(v.grandparent_title, ''), v.title) as display_title,
        v.metadata_type,
        COUNT(*) as play_count,
        COUNT(DISTINCT v.account_id) as viewer_count,
        datetime(MAX(v.viewed_at), 'unixepoch', 'localtime') as last_viewed_at,
        COALESCE(
          -- 1. 쇼 또는 영화 자체의 포스터 (HTTP URL)
          (SELECT m.user_thumb_url FROM metadata_items m WHERE m.title = COALESCE(NULLIF(v.grandparent_title, ''), v.title) AND m.metadata_type IN (1, 2) AND m.user_thumb_url LIKE 'http%' LIMIT 1),
          -- 2. 시즌의 포스터 (HTTP URL)
          (SELECT s.user_thumb_url FROM metadata_items s JOIN metadata_items m ON s.parent_id = m.id WHERE m.title = COALESCE(NULLIF(v.grandparent_title, ''), v.title) AND s.user_thumb_url LIKE 'http%' LIMIT 1),
          -- 3. 쇼의 배경 아트 (팬아트 HTTP URL)
          (SELECT m.user_art_url FROM metadata_items m WHERE m.title = COALESCE(NULLIF(v.grandparent_title, ''), v.title) AND m.metadata_type IN (1, 2) AND m.user_art_url LIKE 'http%' LIMIT 1),
          -- 4. 개별 에피소드 썸네일 (HTTP URL)
          (SELECT m.user_thumb_url FROM metadata_items m WHERE m.title = v.title AND m.user_thumb_url LIKE 'http%' LIMIT 1),
          -- 5. metadata_item_views 기록된 썸네일
          (CASE WHEN v.thumb_url LIKE 'http%' THEN v.thumb_url ELSE NULL END)
        ) as poster_url,
        COALESCE(
          -- 쇼/영화 자체의 ratingKey
          (SELECT m.id FROM metadata_items m WHERE m.title = COALESCE(NULLIF(v.grandparent_title, ''), v.title) AND m.metadata_type IN (1, 2) LIMIT 1),
          -- 없으면 대표 항목 ratingKey
          (SELECT m.id FROM metadata_items m WHERE m.title = v.title LIMIT 1)
        ) as rating_key
      FROM metadata_item_views v
      WHERE v.viewed_at >= strftime('%s', 'now', '-30 days')
      GROUP BY display_title
      ORDER BY play_count DESC
      LIMIT 10;
    `).all() as Array<{
      display_title: string;
      metadata_type: number;
      poster_url: string | null;
      rating_key: number | null;
      play_count: number;
      viewer_count: number;
      last_viewed_at: string;
    }>;

    const maxCount = rows[0]?.play_count || 1;

    const result = rows.map((r, idx) => {
      let typeLabel = "기타";
      if (r.metadata_type === 1) typeLabel = "영화";
      else if (r.metadata_type === 4 || r.metadata_type === 2) typeLabel = "드라마/시리즈";
      else if (r.metadata_type === 8 || r.metadata_type === 9 || r.metadata_type === 10) typeLabel = "음악";

      let thumb = r.poster_url;
      if (!thumb && r.rating_key) {
        thumb = `/api/poster?ratingKey=${r.rating_key}`;
      }

      return {
        rank: idx + 1,
        title: r.display_title,
        metadata_type: r.metadata_type,
        type_label: typeLabel,
        play_count: r.play_count,
        viewer_count: r.viewer_count,
        last_played_at: r.last_viewed_at,
        thumb_url: thumb,
        rating_key: r.rating_key,
        plex_url: makePlexMediaUrl(r.rating_key),
        percentage: Math.round((r.play_count / maxCount) * 100),
      };
    });
    cachedTop10 = { timestamp: now, data: result };
    return result;
  } catch (err) {
    console.error("[Analytics] 최근 30일 Top 10 조회 오류:", err);
    return [];
  }
}

// 4. 이번 달 사용자별 추정 데이터 사용량 (Per-user estimated data consumption this calendar month)
export type UserConsumptionRange = "1h" | "1d" | "1m" | "1y" | "all";

export interface UserMonthlyDataConsumption {
  rank: number;
  account_id: number | null;
  user_name: string;
  alias: string;
  display_name: string;
  total_bytes: number;
  total_bytes_formatted: string;
  lan_bytes: number;
  lan_bytes_formatted: string;
  wan_bytes: number;
  wan_bytes_formatted: string;
  percentage: number; // 전체 사용량 대비 점유율
}

export interface UserConsumptionResult {
  range: UserConsumptionRange;
  range_label: string; // e.g. "최근 1시간", "최근 1일", "최근 1달", "최근 1년", "전체 기간"
  summary: {
    total_bytes: number;
    total_bytes_formatted: string;
    wan_bytes: number;
    wan_bytes_formatted: string;
    lan_bytes: number;
    lan_bytes_formatted: string;
    active_users: number;
    avg_per_user: string;
  };
  users: UserMonthlyDataConsumption[];
}

export type MonthlyConsumptionResult = UserConsumptionResult;

export function getMonthlyUserConsumption(): UserConsumptionResult {
  return getUserDataConsumption("1m");
}

export function getUserDataConsumption(rawRange: string = "1m"): UserConsumptionResult {
  const validRanges: UserConsumptionRange[] = ["1h", "1d", "1m", "1y", "all"];
  const range: UserConsumptionRange = validRanges.includes(rawRange as UserConsumptionRange)
    ? (rawRange as UserConsumptionRange)
    : "1m";

  const nowSec = Math.floor(Date.now() / 1000);
  const aliases = getAliases();

  let rangeLabel = "최근 1달 (30일)";
  let timespan = 4;
  let minEpoch: number | null = nowSec - 30 * 86400;
  let fallbackInterval: string | null = "-30 days";

  if (range === "1h") {
    rangeLabel = "최근 1시간";
    timespan = 4;
    minEpoch = nowSec - 3600;
    fallbackInterval = "-1 hour";
  } else if (range === "1d") {
    rangeLabel = "최근 1일 (24시간)";
    timespan = 4;
    minEpoch = nowSec - 86400;
    fallbackInterval = "-24 hours";
  } else if (range === "1m") {
    rangeLabel = "최근 1달 (30일)";
    timespan = 4;
    minEpoch = nowSec - 30 * 86400;
    fallbackInterval = "-30 days";
  } else if (range === "1y") {
    rangeLabel = "최근 1년 (365일)";
    timespan = 3;
    minEpoch = nowSec - 365 * 86400;
    fallbackInterval = "-365 days";
  } else if (range === "all") {
    rangeLabel = "전체 기간 (누적)";
    timespan = 3;
    minEpoch = null;
    fallbackInterval = null;
  }

  if (!plexDb) {
    const whereClause = fallbackInterval ? "WHERE timestamp >= datetime('now', 'localtime', ?)" : "";
    const params = fallbackInterval ? [fallbackInterval] : [];
    const rows = db.query(`
      SELECT
        user_name,
        SUM(file_size_bytes) as total_bytes,
        SUM(CASE WHEN client_ip LIKE '192.168.%' OR client_ip LIKE '172.%' OR client_ip LIKE '10.%' OR client_ip LIKE '127.%' THEN file_size_bytes ELSE 0 END) as lan_bytes,
        SUM(CASE WHEN client_ip NOT LIKE '192.168.%' AND client_ip NOT LIKE '172.%' AND client_ip NOT LIKE '10.%' AND client_ip NOT LIKE '127.%' THEN file_size_bytes ELSE 0 END) as wan_bytes
      FROM activity_logs
      ${whereClause}
      GROUP BY user_name
      ORDER BY total_bytes DESC
    `).all(...params) as Array<{ user_name: string; total_bytes: number; lan_bytes: number; wan_bytes: number }>;

    let allTotal = 0;
    let allLan = 0;
    let allWan = 0;
    for (const r of rows) {
      allTotal += r.total_bytes;
      allLan += r.lan_bytes;
      allWan += r.wan_bytes;
    }

    const users: UserMonthlyDataConsumption[] = rows.map((r, idx) => {
      const alias = (aliases[r.user_name] || "").trim();
      const displayName = alias ? `${alias} (${r.user_name})` : r.user_name;
      const pct = allTotal > 0 ? Number(((r.total_bytes / allTotal) * 100).toFixed(1)) : 0;
      return {
        rank: idx + 1,
        account_id: null,
        user_name: r.user_name,
        alias,
        display_name: displayName,
        total_bytes: r.total_bytes,
        total_bytes_formatted: formatBytes(r.total_bytes),
        lan_bytes: r.lan_bytes,
        lan_bytes_formatted: formatBytes(r.lan_bytes),
        wan_bytes: r.wan_bytes,
        wan_bytes_formatted: formatBytes(r.wan_bytes),
        percentage: pct,
      };
    });

    const avg = users.length > 0 ? formatBytes(Math.round(allTotal / users.length)) : "0 B";

    return {
      range,
      range_label: rangeLabel,
      summary: {
        total_bytes: allTotal,
        total_bytes_formatted: formatBytes(allTotal),
        wan_bytes: allWan,
        wan_bytes_formatted: formatBytes(allWan),
        lan_bytes: allLan,
        lan_bytes_formatted: formatBytes(allLan),
        active_users: users.length,
        avg_per_user: avg,
      },
      users,
    };
  }

  try {
    const whereClause = minEpoch !== null ? "WHERE b.timespan = ? AND b.at >= ?" : "WHERE b.timespan = ?";
    const params = minEpoch !== null ? [timespan, minEpoch] : [timespan];

    const rows = plexDb.query(`
      SELECT
        b.account_id,
        COALESCE(a.name, '계정 #' || b.account_id) as user_name,
        SUM(b.bytes) as total_bytes,
        SUM(CASE WHEN b.lan = 1 THEN b.bytes ELSE 0 END) as lan_bytes,
        SUM(CASE WHEN b.lan = 0 THEN b.bytes ELSE 0 END) as wan_bytes
      FROM statistics_bandwidth b
      LEFT JOIN accounts a ON a.id = b.account_id
      ${whereClause}
      GROUP BY b.account_id
      ORDER BY total_bytes DESC;
    `).all(...params) as Array<{
      account_id: number;
      user_name: string;
      total_bytes: number;
      lan_bytes: number;
      wan_bytes: number;
    }>;

    let allTotal = 0;
    let allLan = 0;
    let allWan = 0;

    for (const r of rows) {
      allTotal += r.total_bytes;
      allLan += r.lan_bytes;
      allWan += r.wan_bytes;
    }

    const users: UserMonthlyDataConsumption[] = rows.map((r, idx) => {
      const alias = (aliases[r.user_name] || "").trim();
      const displayName = alias ? `${alias} (${r.user_name})` : r.user_name;
      const pct = allTotal > 0 ? Number(((r.total_bytes / allTotal) * 100).toFixed(1)) : 0;
      return {
        rank: idx + 1,
        account_id: r.account_id,
        user_name: r.user_name,
        alias,
        display_name: displayName,
        total_bytes: r.total_bytes,
        total_bytes_formatted: formatBytes(r.total_bytes),
        lan_bytes: r.lan_bytes,
        lan_bytes_formatted: formatBytes(r.lan_bytes),
        wan_bytes: r.wan_bytes,
        wan_bytes_formatted: formatBytes(r.wan_bytes),
        percentage: pct,
      };
    });

    const avg = users.length > 0 ? formatBytes(Math.round(allTotal / users.length)) : "0 B";

    return {
      range,
      range_label: rangeLabel,
      summary: {
        total_bytes: allTotal,
        total_bytes_formatted: formatBytes(allTotal),
        wan_bytes: allWan,
        wan_bytes_formatted: formatBytes(allWan),
        lan_bytes: allLan,
        lan_bytes_formatted: formatBytes(allLan),
        active_users: users.length,
        avg_per_user: avg,
      },
      users,
    };
  } catch (err) {
    console.error(`[Analytics] 사용자 대역폭(${range}) 조회 오류:`, err);
    return {
      range,
      range_label: rangeLabel,
      summary: {
        total_bytes: 0,
        total_bytes_formatted: "0 B",
        wan_bytes: 0,
        wan_bytes_formatted: "0 B",
        lan_bytes: 0,
        lan_bytes_formatted: "0 B",
        active_users: 0,
        avg_per_user: "0 B",
      },
      users: [],
    };
  }
}
