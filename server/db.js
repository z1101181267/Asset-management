import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 支持 DB_DATA_DIR 环境变量：打包后（Electron）指向 userData 目录，dev 模式默认 ./data
const dataDir = process.env.DB_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'db.sqlite'));

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  assets TEXT NOT NULL DEFAULT '[]',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  name TEXT,
  ip TEXT,
  env_type TEXT,
  is_docker INTEGER DEFAULT 0,
  owner TEXT,
  company TEXT,
  status TEXT NOT NULL DEFAULT '在线',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS asset_databases (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  db_type TEXT,
  db_version TEXT,
  port TEXT,
  db_is_docker INTEGER DEFAULT 0,
  seq INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_id TEXT,
  account TEXT,
  password_enc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS change_records (
  id TEXT PRIMARY KEY,
  applicant TEXT,
  asset_id TEXT,
  requirement TEXT,
  status TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  result TEXT,
  executor TEXT,
  time TEXT
);
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT,
  user TEXT,
  action TEXT,
  detail TEXT
);
`);

const KEY_FILE = path.join(dataDir, '.enc-key');
function getAesKey() {
  try {
    return fs.readFileSync(KEY_FILE);
  } catch {
    const key = crypto.randomBytes(32);
    fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
    return key;
  }
}
const AES_KEY = getAesKey();

/* AES-256-GCM 加密数据库/服务器账号密码（服务端字段级加密） */
export function encPassword(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', AES_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: enc.toString('base64'),
  });
}

export function decPassword(cipherText) {
  try {
    const obj = JSON.parse(cipherText);
    const decipher = crypto.createDecipheriv('aes-256-gcm', AES_KEY, Buffer.from(obj.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(obj.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(obj.data, 'base64')), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    return null;
  }
}

/* 旧库迁移：assets 表补 status 列（默认「在线」） */
try {
  const cols = db.prepare(`PRAGMA table_info(assets)`).all().map((c) => c.name);
  if (!cols.includes('status')) {
    db.exec(`ALTER TABLE assets ADD COLUMN status TEXT NOT NULL DEFAULT '在线'`);
    console.log('[db] 已为 assets 表补 status 列（默认在线）');
  }
} catch (e) {
  console.warn('[db] status 迁移检查失败:', e.message);
}

/* 旧库迁移：asset_databases 表补 db_is_docker 列（是否Docker 下沉到每套数据库） */
try {
  const dbCols = db.prepare(`PRAGMA table_info(asset_databases)`).all().map((c) => c.name);
  if (!dbCols.includes('db_is_docker')) {
    db.exec(`ALTER TABLE asset_databases ADD COLUMN db_is_docker INTEGER NOT NULL DEFAULT 0`);
    console.log('[db] 已为 asset_databases 表补 db_is_docker 列');
  }
} catch (e) {
  console.warn('[db] db_is_docker 迁移检查失败:', e.message);
}

const stmts = {
  listUsers: db.prepare(`SELECT username, password_hash, role, assets, created_at FROM users ORDER BY username`),
  findUser: db.prepare(`SELECT * FROM users WHERE username = ?`),
  insertUser: db.prepare(`INSERT INTO users (username, password_hash, role, assets, created_at) VALUES (?,?,?,?,?)`),
  delUser: db.prepare(`DELETE FROM users WHERE username = ? AND username <> 'admin'`),
  setUserAssets: db.prepare(`UPDATE users SET assets = ? WHERE username = ?`),
  setUserPass: db.prepare(`UPDATE users SET password_hash = ? WHERE username = ?`),

  listAssets: db.prepare(`SELECT * FROM assets ORDER BY created_at`),
  findAsset: db.prepare(`SELECT * FROM assets WHERE id = ?`),
  setAssetStatus: db.prepare(`UPDATE assets SET status = ? WHERE id = ?`),
  insertAsset: db.prepare(`INSERT INTO assets (id, name, ip, env_type, is_docker, owner, company, created_at) VALUES (?,?,?,?,?,?,?,?)`),
  delAsset: db.prepare(`DELETE FROM assets WHERE id = ?`),
  insertDb: db.prepare(`INSERT INTO asset_databases (id, asset_id, db_type, db_version, port, db_is_docker, seq) VALUES (?,?,?,?,?,?,?)`),
  updateDb: db.prepare(`UPDATE asset_databases SET db_type = ?, db_version = ?, port = ?, db_is_docker = ? WHERE id = ?`),
  delDb: db.prepare(`DELETE FROM asset_databases WHERE id = ?`),
  listDbs: db.prepare(`SELECT * FROM asset_databases WHERE asset_id = ? ORDER BY seq`),
  findDb: db.prepare(`SELECT * FROM asset_databases WHERE id = ?`),
  allDbs: db.prepare(`SELECT * FROM asset_databases`),
  listAccounts: db.prepare(`SELECT * FROM accounts WHERE asset_id = ? ORDER BY id`),
  findAccount: db.prepare(`SELECT * FROM accounts WHERE id = ?`),
  delAccountsByRef: db.prepare(`DELETE FROM accounts WHERE ref_id = ?`),
  delAccountsOfAsset: db.prepare(`DELETE FROM accounts WHERE asset_id = ?`),
  insertAccount: db.prepare(`INSERT INTO accounts (id, asset_id, kind, ref_id, account, password_enc) VALUES (?,?,?,?,?,?)`),
  delAccount: db.prepare(`DELETE FROM accounts WHERE id = ?`),

  listRecords: db.prepare(`SELECT * FROM change_records ORDER BY rowid DESC`),
  findRecord: db.prepare(`SELECT * FROM change_records WHERE id = ?`),
  insertRecord: db.prepare(`INSERT INTO change_records (id, applicant, asset_id, requirement, status, created_at) VALUES (?,?,?,?,?,?)`),
  delRecord: db.prepare(`DELETE FROM change_records WHERE id = ?`),
  delExecsOfRecord: db.prepare(`DELETE FROM executions WHERE record_id = ?`),
  setRecordStatus: db.prepare(`UPDATE change_records SET status = ? WHERE id = ?`),
  insertExec: db.prepare(`INSERT INTO executions (id, record_id, result, executor, time) VALUES (?,?,?,?,?)`),
  listExecs: db.prepare(`SELECT * FROM executions WHERE record_id = ? ORDER BY rowid`),

  getConfig: db.prepare(`SELECT value FROM config WHERE key = ?`),
  setConfig: db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`),

  addAudit: db.prepare(`INSERT INTO audit_log (time, user, action, detail) VALUES (?,?,?,?)`),
  listAudit: db.prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`),
  countUsers: db.prepare(`SELECT COUNT(*) AS n FROM users`),
};

export { db, stmts };
