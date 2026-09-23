import { Database } from "bun:sqlite";

const PLEX_DB_PATH =
  process.env.PLEX_DB_PATH ||
  "/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.db";

let dbInstance: Database | null = null;

try {
  dbInstance = new Database(PLEX_DB_PATH, { readonly: true });
  dbInstance.run("PRAGMA query_only = ON;");
} catch (err) {
  // Plex가 없는 환경(개발/CI/신규 클론)에서는 정상적인 상태이므로 스택 전체 대신 한 줄로 알린다.
  console.warn(
    "[PlexDB] Plex SQLite DB를 열 수 없어 메타데이터/포스터 기능만 비활성화됩니다:",
    err instanceof Error ? err.message : err
  );
}

export const plexDb = dbInstance;
export const isPlexDbAvailable = dbInstance !== null;
