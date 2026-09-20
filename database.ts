import { Database } from "bun:sqlite";
import { join } from "path";

const DB_PATH = join(import.meta.dir, "data", "plex_dashboard.db");
export const db = new Database(DB_PATH);

// WAL 모드 활성화로 높은 동시성 확보
db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA synchronous = NORMAL;");

export function initDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_hash TEXT UNIQUE,
      timestamp TEXT NOT NULL,
      user_name TEXT NOT NULL,
      user_id TEXT,
      client_ip TEXT,
      device_name TEXT,
      platform TEXT,
      activity_type TEXT NOT NULL,
      media_id TEXT,
      show_title TEXT,
      season_index INTEGER,
      episode_index INTEGER,
      episode_title TEXT,
      media_title TEXT,
      media_type TEXT,
      progress_ms INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      file_size_bytes INTEGER DEFAULT 0,
      raw_summary TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      client_id TEXT,
      product TEXT,
      client_version TEXT,
      ip_location TEXT,
      is_stream INTEGER DEFAULT 0
    );
  `);
  // 기존 DB 무중단 마이그레이션
  const cols = db.query(`PRAGMA table_info(activity_logs)`).all() as unknown as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));
  const alter = (sql: string) => { try { db.run(sql); } catch { /* 이미 존재 */ } };
  if (!colNames.has("client_id")) alter(`ALTER TABLE activity_logs ADD COLUMN client_id TEXT`);
  if (!colNames.has("product")) alter(`ALTER TABLE activity_logs ADD COLUMN product TEXT`);
  if (!colNames.has("client_version")) alter(`ALTER TABLE activity_logs ADD COLUMN client_version TEXT`);
  if (!colNames.has("ip_location")) alter(`ALTER TABLE activity_logs ADD COLUMN ip_location TEXT`);
  if (!colNames.has("is_stream")) alter(`ALTER TABLE activity_logs ADD COLUMN is_stream INTEGER DEFAULT 0`);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_logs(timestamp DESC);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_name, timestamp DESC);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_logs(activity_type);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS log_cursors (
      file_name TEXT PRIMARY KEY,
      last_offset INTEGER DEFAULT 0,
      last_inode INTEGER DEFAULT 0,
      last_parsed_at TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_aliases (
      user_name TEXT PRIMARY KEY,
      alias TEXT NOT NULL DEFAULT ''
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ip_location_cache (
      ip TEXT PRIMARY KEY,
      location TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS device_profiles (
      pkey TEXT PRIMARY KEY,
      device_name TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      product TEXT,
      client_version TEXT,
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);
  // 기본 설정 주입
  const insertSetting = db.query(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
  );
  insertSetting.run("retention_days", "90");
  insertSetting.run("import_interval_sec", "30");
  insertSetting.run("port", "32420");
  insertSetting.run("show_stream_downloads", "1");
}
// 모듈 로드 시 DB 초기화 실행
initDatabase();

export interface ActivityInsert {
  event_hash: string;
  timestamp: string;
  user_name: string;
  user_id?: string | null;
  client_ip?: string | null;
  device_name?: string | null;
  platform?: string | null;
  activity_type: string;
  media_id?: string | null;
  show_title?: string | null;
  season_index?: number | null;
  episode_index?: number | null;
  episode_title?: string | null;
  media_title?: string | null;
  media_type?: string | null;
  progress_ms?: number;
  duration_ms?: number;
  file_size_bytes?: number;
  raw_summary?: string | null;
  client_id?: string | null;
  product?: string | null;
  client_version?: string | null;
  ip_location?: string | null;
  is_stream?: number;
}

const insertActivityStmt = db.prepare(`
  INSERT OR IGNORE INTO activity_logs (
    event_hash, timestamp, user_name, user_id, client_ip, device_name,
    platform, activity_type, media_id, show_title, season_index,
    episode_index, episode_title, media_title, media_type, progress_ms,
    duration_ms, file_size_bytes, raw_summary, client_id, product,
    client_version, ip_location, is_stream
  ) VALUES (
    $event_hash, $timestamp, $user_name, $user_id, $client_ip, $device_name,
    $platform, $activity_type, $media_id, $show_title, $season_index,
    $episode_index, $episode_title, $media_title, $media_type, $progress_ms,
    $duration_ms, $file_size_bytes, $raw_summary, $client_id, $product,
    $client_version, $ip_location, $is_stream
  )
`);

export function insertActivity(act: ActivityInsert) {
  return insertActivityStmt.run({
    $event_hash: act.event_hash,
    $timestamp: act.timestamp,
    $user_name: act.user_name,
    $user_id: act.user_id ?? null,
    $client_ip: act.client_ip ?? null,
    $device_name: act.device_name ?? null,
    $platform: act.platform ?? null,
    $activity_type: act.activity_type,
    $media_id: act.media_id ?? null,
    $show_title: act.show_title ?? null,
    $season_index: act.season_index ?? null,
    $episode_index: act.episode_index ?? null,
    $episode_title: act.episode_title ?? null,
    $media_title: act.media_title ?? null,
    $media_type: act.media_type ?? null,
    $progress_ms: act.progress_ms ?? 0,
    $duration_ms: act.duration_ms ?? 0,
    $file_size_bytes: act.file_size_bytes ?? 0,
    $raw_summary: act.raw_summary ?? null,
    $client_id: act.client_id ?? null,
    $product: act.product ?? null,
    $client_version: act.client_version ?? null,
    $ip_location: act.ip_location ?? null,
    $is_stream: act.is_stream ?? 0,
  });
 }
export interface ActivityRow extends ActivityInsert {
  id: number;
  created_at: string;
  alias: string;
  display_name: string;
}

export interface StatsResult {
  total_users: number;
  active_users_today: number;
  total_plays: number;
  total_downloads: number;
  total_events: number;
}

export function getActivities(options: {
  user?: string;
  type?: string;
  limit?: number;
  offset?: number;
  hideStream?: boolean;
}) {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.user && options.user !== "all") {
    conditions.push("user_name = ?");
    params.push(options.user);
  }

  if (options.type && options.type !== "all") {
    conditions.push("activity_type = ?");
    params.push(options.type);
  }

  if (options.hideStream) {
    conditions.push("(activity_type != 'DOWNLOAD' OR COALESCE(is_stream, 0) = 0)");
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const itemWhere = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ").replace(/user_name/g, "a.user_name").replace(/activity_type/g, "a.activity_type")}`
    : "";
  const query = `
    SELECT a.*, COALESCE(u.alias, '') as alias,
      CASE WHEN COALESCE(u.alias, '') != '' THEN u.alias ELSE a.user_name END as display_name
    FROM activity_logs a
    LEFT JOIN user_aliases u ON u.user_name = a.user_name
    ${itemWhere}
    ORDER BY a.timestamp DESC, a.id DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const countQuery = `
    SELECT COUNT(*) as total FROM activity_logs
    ${whereClause}
  `;
  const countParams = params.slice(0, -2);

  const items = db.query(query).all(...params) as unknown as ActivityRow[];
  const countRow = db.query(countQuery).get(...countParams) as { total: number } | null;
  const total = countRow?.total ?? 0;

  return { items, total, limit, offset };
}
export interface UserRow {
  user_name: string;
  count: number;
  last_seen: string;
  alias: string;
  display_name: string;
}
export function getUserList(): UserRow[] {
  const rows = db.query(`
    SELECT a.user_name, COUNT(*) as count, MAX(a.timestamp) as last_seen,
      COALESCE(u.alias, '') as alias,
      CASE WHEN COALESCE(u.alias, '') != '' THEN u.alias ELSE a.user_name END as display_name
    FROM activity_logs a
    LEFT JOIN user_aliases u ON u.user_name = a.user_name
    GROUP BY a.user_name
    ORDER BY last_seen DESC
  `).all() as unknown as UserRow[];
  return rows;
}
export function getAliases(): Record<string, string> {
  const rows = db.query(`SELECT user_name, alias FROM user_aliases`).all() as unknown as { user_name: string; alias: string }[];
  const map: Record<string, string> = {};
  for (const r of rows) map[r.user_name] = r.alias;
  return map;
}
export function setAlias(userName: string, alias: string) {
  const clean = alias.trim();
  if (clean === "") {
    db.query(`DELETE FROM user_aliases WHERE user_name = ?`).run(userName);
    return;
  }
  db.query(`INSERT OR REPLACE INTO user_aliases (user_name, alias) VALUES (?, ?)`).run(userName, clean);
 }
export function getDashboardStats(): StatsResult {
  const today = new Date().toISOString().slice(0, 10);
  const stats = db.query(`
    SELECT
      COUNT(DISTINCT user_name) as total_users,
      COUNT(DISTINCT CASE WHEN timestamp LIKE ? || '%' THEN user_name END) as active_users_today,
      COUNT(CASE WHEN activity_type LIKE 'PLAY%' THEN 1 END) as total_plays,
      COUNT(CASE WHEN activity_type = 'DOWNLOAD' THEN 1 END) as total_downloads,
      COUNT(*) as total_events
    FROM activity_logs
  `).get(today) as StatsResult | null;
  return stats ?? {
    total_users: 0,
    active_users_today: 0,
    total_plays: 0,
    total_downloads: 0,
    total_events: 0,
  };
}

export function getSetting(key: string, defaultValue = ""): string {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return row ? row.value : defaultValue;
}
export function setSetting(key: string, value: string) {
  db.query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}
export function getCachedLocation(ip: string): string | null {
  const row = db.query(`SELECT location FROM ip_location_cache WHERE ip = ?`).get(ip) as { location: string } | null;
  return row?.location ?? null;
}
export function setCachedLocation(ip: string, location: string) {
  db.query(`INSERT OR REPLACE INTO ip_location_cache (ip, location, updated_at) VALUES (?, ?, datetime('now', 'localtime'))`).run(ip, location);
}
export function getUncachedIps(ips: string[]): string[] {
  if (ips.length === 0) return [];
  const placeholders = ips.map(() => "?").join(",");
  const rows = db.query(`SELECT ip FROM ip_location_cache WHERE ip IN (${placeholders})`).all(...ips) as unknown as { ip: string }[];
  const cached = new Set(rows.map((r) => r.ip));
  return ips.filter((ip) => !cached.has(ip));
}
export interface DeviceProfileRow {
  device_name: string;
  platform: string;
  product: string | null;
  client_version: string | null;
}
export function getDeviceProfile(pkey: string): DeviceProfileRow | null {
  const row = db.query(`SELECT device_name, platform, product, client_version FROM device_profiles WHERE pkey = ?`).get(pkey) as DeviceProfileRow | null;
  return row;
}
export function saveDeviceProfile(pkey: string, p: DeviceProfileRow) {
  db.query(`INSERT OR REPLACE INTO device_profiles (pkey, device_name, platform, product, client_version, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`)
    .run(pkey, p.device_name, p.platform, p.product, p.client_version);
}

export function cleanupExpiredLogs() {
  const daysStr = getSetting("retention_days", "90");
  const days = parseInt(daysStr, 10);
  if (isNaN(days) || days <= 0) {
    // 0 이하는 무제한 보관
    return 0;
  }

  const res = db.run(
    `DELETE FROM activity_logs WHERE timestamp < datetime('now', '-' || ? || ' days', 'localtime')`,
    [days]
  );
  return res.changes;
}
