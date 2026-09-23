import { Database } from "bun:sqlite";

const PLEX_DB_PATH =
  process.env.PLEX_DB_PATH ||
  "/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.db";

let dbInstance: Database | null = null;

try {
  dbInstance = new Database(PLEX_DB_PATH, { readonly: true });
  dbInstance.run("PRAGMA query_only = ON;");
} catch (err) {
  console.warn("[PlexDB] Plex SQLite DB 연결 실패 (읽기 전용):", err);
}

export const plexDb = dbInstance;
export const isPlexDbAvailable = dbInstance !== null;
