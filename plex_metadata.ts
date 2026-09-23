import { plexDb } from "./plex_db.ts";
import { BoundedMap } from "./bounded_map.ts";
export interface MediaMetadata {
  rating_key: string;
  media_type: "episode" | "movie" | "track" | "other";
  show_title: string | null;
  season_index: number | null;
  episode_index: number | null;
  episode_title: string | null;
  year: number | null;
  media_title: string;
}

const metadataCache = new BoundedMap<string, MediaMetadata>(3000);
const partIdCache = new BoundedMap<string, string>(3000); // partId -> ratingKey
const filePathCache = new BoundedMap<string, string>(3000); // 미디어 파일 경로 -> partId ("0" = 조회 실패 캐시)

/**
 * 로그에 찍힌 미디어 파일 절대 경로를 Plex DB의 media_parts.id로 역추적한다.
 * Content-Length 라인에는 요청 ID가 없어서, 동시 다운로드 상황에서 엉뚱한 세션에
 * 귀속되는 것을 막기 위해 사용한다.
 */
export function resolvePartIdByFilePath(filePath: string): string | null {
  const key = filePath.trim();
  if (!key) return null;
  const cached = filePathCache.get(key);
  if (cached !== undefined) return cached === "0" ? null : cached;
  if (!plexDb) return null;

  try {
    const exact = plexDb.query(`SELECT id FROM media_parts WHERE file = ? LIMIT 1`).get(key) as { id: number } | null;
    let partId: number | null = exact?.id ?? null;
    if (partId === null) {
      // Plex가 정규화/심볼릭 링크 경로를 저장한 경우를 대비해 파일명 기준으로 한 번 더 확인
      const baseName = key.split(/[\\/]/).pop() ?? "";
      if (baseName) {
        const escaped = baseName.replace(/[\\%_]/g, (ch) => `\\${ch}`);
        const byName = plexDb
          .query(`SELECT id FROM media_parts WHERE file LIKE ? ESCAPE '\\' LIMIT 1`)
          .get(`%/${escaped}`) as { id: number } | null;
        partId = byName?.id ?? null;
      }
    }
    filePathCache.set(key, partId === null ? "0" : String(partId));
    return partId === null ? null : String(partId);
  } catch (err) {
    console.error(`[PlexMetadata] 파일 경로 → partId 조회 오류 (${key}):`, err);
    return null;
  }
}

export function resolveMediaByRatingKey(
  ratingKey: number | string,
  rawTitleFallback?: string
): MediaMetadata {
  const keyStr = String(ratingKey);
  if (metadataCache.has(keyStr)) {
    return metadataCache.get(keyStr)!;
  }

  if (!plexDb) {
    const fallback: MediaMetadata = {
      rating_key: keyStr,
      media_type: "other",
      show_title: null,
      season_index: null,
      episode_index: null,
      episode_title: rawTitleFallback ?? null,
      year: null,
      media_title: rawTitleFallback ?? `미디어 #${keyStr}`,
    };
    return fallback;
  }

  try {
    const row = plexDb
      .query(
        `
      SELECT 
        e.id AS rating_key,
        e.metadata_type,
        e.title AS item_title,
        e.[index] AS item_index,
        e.year AS item_year,
        s.title AS parent_title,
        s.[index] AS parent_index,
        show.title AS grandparent_title
      FROM metadata_items e
      LEFT JOIN metadata_items s ON e.parent_id = s.id
      LEFT JOIN metadata_items show ON s.parent_id = show.id
      WHERE e.id = ?
    `
      )
      .get(ratingKey) as {
      rating_key: number;
      metadata_type: number;
      item_title: string;
      item_index: number | null;
      item_year: number | null;
      parent_title: string | null;
      parent_index: number | null;
      grandparent_title: string | null;
    } | null;

    if (!row) {
      const fallback: MediaMetadata = {
        rating_key: keyStr,
        media_type: "other",
        show_title: null,
        season_index: null,
        episode_index: null,
        episode_title: rawTitleFallback ?? null,
        year: null,
        media_title: rawTitleFallback ?? `미디어 #${keyStr}`,
      };
      metadataCache.set(keyStr, fallback);
      return fallback;
    }

    let media_type: MediaMetadata["media_type"] = "other";
    let show_title: string | null = null;
    let season_index: number | null = null;
    let episode_index: number | null = null;
    let episode_title: string | null = null;
    let media_title = row.item_title;

    if (row.metadata_type === 4) {
      // 에피소드 (TV Episode)
      media_type = "episode";
      show_title = row.grandparent_title || row.parent_title || null;
      season_index = row.parent_index ?? null;
      episode_index = row.item_index ?? null;
      episode_title = row.item_title;

      const seasonPart = season_index !== null ? `시즌 ${season_index}` : "";
      const epPart = episode_index !== null ? `${episode_index}화` : "";
      const prefix = [seasonPart, epPart].filter(Boolean).join(" ");

      if (show_title) {
        media_title = `${show_title} ${prefix ? `[${prefix}] ` : ""}- ${episode_title}`;
      } else {
        media_title = `${prefix ? `[${prefix}] ` : ""}${episode_title}`;
      }
    } else if (row.metadata_type === 1) {
      // 영화 (Movie)
      media_type = "movie";
      media_title = row.item_year ? `${row.item_title} (${row.item_year})` : row.item_title;
    } else if (row.metadata_type === 10) {
      // 음악 트랙
      media_type = "track";
      const artist = row.grandparent_title;
      media_title = artist ? `${artist} - ${row.item_title}` : row.item_title;
    }

    const meta: MediaMetadata = {
      rating_key: keyStr,
      media_type,
      show_title,
      season_index,
      episode_index,
      episode_title,
      year: row.item_year,
      media_title: media_title.trim(),
    };

    metadataCache.set(keyStr, meta);
    return meta;
  } catch (err) {
    console.error(`ratingKey ${ratingKey} 메타데이터 조회 오류:`, err);
    const fallback: MediaMetadata = {
      rating_key: keyStr,
      media_type: "other",
      show_title: null,
      season_index: null,
      episode_index: null,
      episode_title: rawTitleFallback ?? null,
      year: null,
      media_title: rawTitleFallback ?? `미디어 #${keyStr}`,
    };
    return fallback;
  }
}

export function resolveMediaByPartId(partId: number | string): MediaMetadata | null {
  const pStr = String(partId);
  if (partIdCache.has(pStr)) {
    return resolveMediaByRatingKey(partIdCache.get(pStr)!);
  }

  if (!plexDb) return null;

  try {
    const row = plexDb
      .query(
        `
      SELECT mi.metadata_item_id
      FROM media_parts mp
      JOIN media_items mi ON mp.media_item_id = mi.id
      WHERE mp.id = ?
    `
      )
      .get(partId) as { metadata_item_id: number } | null;

    if (row && row.metadata_item_id) {
      partIdCache.set(pStr, String(row.metadata_item_id));
      return resolveMediaByRatingKey(row.metadata_item_id);
    }
  } catch (err) {
    console.error(`partId ${partId} 메타데이터 조회 오류:`, err);
  }

  return null;
}
