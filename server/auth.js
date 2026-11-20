import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stmts, db } from './db.js';

// JWT 密钥持久化位置：支持 DB_DATA_DIR（打包后为 userData），否则默认 ../data
const KEY_DIR = process.env.DB_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const keyFile = path.join(KEY_DIR, '.jwt-secret');
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  // 首次生成并持久化，避免重启后旧 token 失效
  try {
    return fs.readFileSync(keyFile, 'utf8');
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(KEY_DIR, { recursive: true });
    fs.writeFileSync(keyFile, s, { mode: 0o600 });
    return s;
  }
})();

/* ---------- 登录限流：同一账号 15 分钟内失败 5 次锁定 ---------- */
const failMap = new Map(); // ip|user -> { count, until }
export function checkRateLimit(ip, username) {
  const k = `${ip}|${username}`;
  const rec = failMap.get(k);
  const now = Date.now();
  if (rec && now < rec.until) return { locked: true, remainSec: Math.ceil((rec.until - now) / 1000) };
  return { locked: false };
}

export function recordLoginFail(ip, username) {
  const k = `${ip}|${username}`;
  const now = Date.now();
  const rec = failMap.get(k);
  if (!rec || now > rec.until) failMap.set(k, { count: 1, until: now + 15 * 60 * 1000 });
  else rec.count += 1;
  const cur = failMap.get(k);
  if (cur.count >= 5) cur.until = now + 15 * 60 * 1000; // 达到 5 次失败即锁定 15 分钟
  return cur.count;
}

export function clearLoginFail(ip, username) {
  failMap.delete(`${ip}|${username}`);
}

/* ---------- JWT ---------- */
export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

export function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

export function adminOnly(req, res, next) {
  if (req.user?.role !== '管理员') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

/* ---------- 服务端审计（只增不删，前端不可篡改） ---------- */
export function audit(user, action, detail) {
  const time = new Date().toISOString().replace('T', ' ').slice(0, 19);
  stmts.addAudit.run(time, user, action, detail || '');
}
