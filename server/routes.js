import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { stmts, encPassword, decPassword } from './db.js';
import {
  authRequired,
  adminOnly,
  signToken,
  checkRateLimit,
  recordLoginFail,
  clearLoginFail,
  audit,
} from './auth.js';
import { DEFAULT_PORT, OFFICIAL_DB_VERSIONS } from '../src/constants.js';

export const api = Router();

function ip(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '?';
}

function nowText() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/* ---------- 行转模型 ---------- */
function assetModel(row, dbs, accounts) {
  const serverAccounts = [];
  const dbAccountsByDb = {};
  for (const acc of accounts) {
    const item = { id: acc.id, account: acc.account, password: '[encrypted]' };
    if (acc.kind === 'server') serverAccounts.push(item);
    else (dbAccountsByDb[acc.ref_id] ||= []).push(item);
  }
  return {
    id: row.id,
    name: row.name,
    ip: row.ip,
    envType: row.env_type,
    isDocker: !!row.is_docker,
    owner: row.owner,
    company: row.company,
    status: row.status || '在线',
    databases: dbs.map((d, i) => ({
      id: d.id,
      dbType: d.db_type,
      dbVersion: d.db_version,
      port: d.port,
      dbIsDocker: !!d.db_is_docker,
      seq: i,
      dbAccounts: dbAccountsByDb[d.id] || [],
    })),
    serverAccounts,
    createdAt: row.created_at,
  };
}

function loadAsset(id) {
  const row = stmts.findAsset.get(id);
  if (!row) return null;
  const dbs = stmts.listDbs.all(id);
  const accounts = stmts.listAccounts.all(id);
  return assetModel(row, dbs, accounts);
}

/* ================= 登录（限流 + 哈希校验 + 审计） ================= */
api.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const ip_ = ip(req);
  const rl = checkRateLimit(ip_, String(username || ''));
  if (rl.locked) {
    return res.status(429).json({ error: `登录失败次数过多，请 ${rl.remainSec} 秒后再试` });
  }
  const u = stmts.findUser.get(String(username || '').trim());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) {
    const n = recordLoginFail(ip_, String(username || '').trim());
    return res.status(401).json({
      error: `账号或密码不正确${n >= 5 ? `，连续失败 ${n} 次已锁定 15 分钟` : ''}`,
    });
  }
  clearLoginFail(ip_, u.username);
  audit(u.username, '登录', '成功');
  const token = signToken({ username: u.username, role: u.role });
  res.json({
    token,
    user: {
      username: u.username,
      role: u.role,
      // 普通用户返回其授权资产 id（服务端再次校验，前端只做展示过滤）
      assets: u.role === '管理员' ? [] : JSON.parse(u.assets || '[]'),
    },
  });
});

api.post('/logout', authRequired, (req, res) => {
  audit(req.user.username, '登出', '');
  res.json({ ok: true });
});

/* 普通用户仅能查看被授权资产，服务端强制过滤 */
function assertAssetAccess(req, res, assetId) {
  if (req.user.role === '管理员') return true;
  const u = stmts.findUser.get(req.user.username);
  const granted = JSON.parse(u?.assets || '[]');
  if (!granted.includes(assetId)) {
    res.status(403).json({ error: '无权访问该资产' });
    return false;
  }
  return true;
}

api.get('/bootstrap', authRequired, (req, res) => {
  const isAdmin = req.user.role === '管理员';
  const granted = isAdmin ? [] : JSON.parse(stmts.findUser.get(req.user.username)?.assets || '[]');
  const allAssets = stmts.listAssets.all().map((row) => loadAsset(row.id));
  const toRecord = (r) => ({
    id: r.id,
    applicant: r.applicant,
    assetId: r.asset_id,
    requirement: r.requirement,
    status: r.status,
    createTime: r.created_at,
    executions: stmts.listExecs.all(r.id).map((e) => ({
      id: e.id,
      result: e.result,
      executor: e.executor,
      time: e.time,
    })),
  });
  const records = stmts.listRecords.all().map(toRecord);
  res.json({
    user: { username: req.user.username, role: req.user.role, assets: granted },
    assets: isAdmin ? allAssets : allAssets.filter((a) => granted.includes(a.id)),
    records: isAdmin ? records : records.filter((r) => !r.assetId || granted.includes(r.assetId)),
    config: loadConfig(),
  });
});

/* ================= 配置管理（仅管理员可改，普通用户只读） ================= */
function loadConfig() {
  const get = (k) => stmts.getConfig.get(k)?.value;
  return JSON.parse(get('main') || 'null') || {};
}
function saveConfig(cfg) {
  stmts.setConfig.run('main', JSON.stringify(cfg));
}

api.get('/config', authRequired, (_req, res) => {
  res.json({ config: loadConfig() });
});

api.put('/config', authRequired, adminOnly, (req, res) => {
  saveConfig(req.body.config || {});
  audit(req.user.username, '更新配置', '保存配置管理内容');
  res.json({ ok: true, config: loadConfig() });
});

/* 同步官方版本：官方基线排前，用户自定义保留在后，清理误写项 */
api.post('/config/sync-official', authRequired, adminOnly, (req, res) => {
  let cfg = loadConfig();
  let changed = false;
  for (const type of Object.keys(OFFICIAL_DB_VERSIONS)) {
    const cur = cfg.dbVersions?.[type] || [];
    const custom = cur.filter((v) => !OFFICIAL_DB_VERSIONS[type].includes(v) && !(type === 'Oracle' && v === '23c'));
    const next = [...OFFICIAL_DB_VERSIONS[type], ...custom];
    if (JSON.stringify(next) !== JSON.stringify(cur)) {
      (cfg.dbVersions ||= {})[type] = next;
      changed = true;
    }
  }
  cfg.officialSyncAt = nowText();
  saveConfig(cfg);
  audit(req.user.username, '同步官方版本', changed ? '版本清单已对齐官方最新发布' : '无变化');
  res.json({ ok: true, changed, config: cfg });
});

/* ================= 资产设备 ================= */
api.get('/assets/:id', authRequired, (req, res) => {
  if (!assertAssetAccess(req, res, req.params.id)) return;
  const a = loadAsset(req.params.id);
  if (!a) return res.status(404).json({ error: '资产不存在' });
  res.json({ asset: a });
});

api.post('/assets', authRequired, adminOnly, (req, res) => {
  const p = req.body.payload || {};
  const id = uid('a');
  stmts.insertAsset.run(id, p.name, p.ip, p.envType, p.isDocker ? 1 : 0, p.owner || '', p.company || '', p.createdAt || nowText());
  (p.databases || []).forEach((d, i) => {
    const dbId = d.id || uid('dbx');
    stmts.insertDb.run(dbId, id, d.dbType, d.dbVersion, d.port, d.dbIsDocker ? 1 : 0, i);
    (d.dbAccounts || []).forEach((acc) => {
      stmts.insertAccount.run(acc.id || uid('acc'), id, 'db', dbId, acc.account, encPassword(acc.password));
    });
  });
  (p.serverAccounts || []).forEach((acc) => {
    stmts.insertAccount.run(acc.id || uid('acc'), id, 'server', null, acc.account, encPassword(acc.password));
  });
  audit(req.user.username, '新增资产设备', `${p.name}（${p.ip}，${(p.databases || []).length} 套数据库）`);
  res.json({ ok: true, asset: loadAsset(id) });
});

/* 删除资产（级联删除其数据库与账号） */
api.delete('/assets/:id', authRequired, adminOnly, (req, res) => {
  const a = loadAsset(req.params.id);
  if (!a) return res.status(404).json({ error: '资产不存在' });
  for (const d of a.databases) stmts.delAccountsByRef.run(d.id);
  stmts.delAccountsOfAsset.run(a.id);
  for (const d of a.databases) stmts.delDb.run(d.id);
  stmts.delAsset.run(a.id);
  audit(req.user.username, '删除资产设备', a.name);
  res.json({ ok: true });
});

/* 修改资产使用状态（在线/离线/维护等），仅管理员，审计留痕 */
api.put('/assets/:id/status', authRequired, adminOnly, (req, res) => {
  const a = loadAsset(req.params.id);
  if (!a) return res.status(404).json({ error: '资产不存在' });
  const status = String(req.body.status || '').trim() || '在线';
  stmts.setAssetStatus.run(status, a.id);
  audit(req.user.username, '修改资产状态', `${a.name} → ${status}`);
  res.json({ ok: true, status });
});

/* 数据库配置：新增 / 编辑 / 删除 */
api.post('/assets/:id/databases', authRequired, adminOnly, (req, res) => {
  if (!assertAssetAccess(req, res, req.params.id)) return;
  const t = req.body.dbType || 'Oracle';
  const dbId = uid('dbx');
  stmts.insertDb.run(dbId, req.params.id, t, req.body.dbVersion || '', req.body.port || DEFAULT_PORT[t] || '', req.body.dbIsDocker ? 1 : 0, 999);
  audit(req.user.username, '新增数据库配置', `${req.params.id} 添加 ${t}`);
  res.json({ ok: true, dbId });
});

api.put('/databases/:dbId', authRequired, adminOnly, (req, res) => {
  stmts.updateDb.run(req.body.dbType, req.body.dbVersion, req.body.port, req.body.dbIsDocker ? 1 : 0, req.params.dbId);
  audit(req.user.username, '编辑数据库配置', `${req.params.dbId} → ${req.body.dbType} ${req.body.dbVersion} :${req.body.port}`);
  res.json({ ok: true });
});

api.delete('/databases/:dbId', authRequired, adminOnly, (req, res) => {
  const db_ = stmts.findDb.get(req.params.dbId);
  if (!db_) return res.status(404).json({ error: '数据库配置不存在' });
  // 先清理挂在该数据库下的账号，再删除数据库配置
  stmts.delAccountsByRef.run(req.params.dbId);
  stmts.delDb.run(req.params.dbId);
  audit(req.user.username, '删除数据库配置', req.params.dbId);
  res.json({ ok: true });
});

/* 账号：新增（服务端加密）/ 删除；密码字段永不返回明文给列表接口 */
api.post('/accounts', authRequired, adminOnly, (req, res) => {
  const { assetId, kind, refId, account, password } = req.body;
  if (!assertAssetAccess(req, res, assetId)) return;
  const id = uid('acc');
  stmts.insertAccount.run(id, assetId, kind, refId || null, account, encPassword(password));
  audit(req.user.username, '新增账号', `${kind === 'server' ? '服务器' : '数据库'}账号 ${account}（${assetId}）`);
  res.json({ ok: true, id });
});

api.delete('/accounts/:id', authRequired, adminOnly, (req, res) => {
  const acc = stmts.findAccount.get(req.params.id);
  if (!acc) return res.status(404).json({ error: '账号不存在' });
  stmts.delAccount.run(req.params.id);
  audit(req.user.username, '删除账号', `${acc.account}（${acc.kind}）`);
  res.json({ ok: true });
});

/* 查看明文密码：服务端校验“当前用户为管理员且其账号密码正确”，通过才解密，并审计 */
api.post('/accounts/:id/reveal', authRequired, (req, res) => {
  const acc = stmts.findAccount.get(req.params.id);
  if (!acc) return res.status(404).json({ error: '账号不存在' });
  // 普通用户需通过资产授权校验
  if (!assertAssetAccess(req, res, acc.asset_id)) return;
  const { adminUsername, adminPassword } = req.body || {};
  if (req.user.role === '管理员') {
    // 管理员直接展开也需记录审计
    audit(req.user.username, '查看明文密码', `${acc.account}（管理员直接展开）`);
    const plain = decPassword(acc.password_enc);
    return plain === null
      ? res.status(500).json({ error: '解密失败' })
      : res.json({ password: plain });
  }
  const admin = stmts.findUser.get(String(adminUsername || '').trim());
  if (!admin || admin.role !== '管理员' || !bcrypt.compareSync(String(adminPassword || ''), admin.password_hash)) {
    audit(req.user.username, '查看明文密码-验证失败', `${acc.account}（管理员 ${adminUsername} 校验未通过）`);
    return res.status(403).json({ error: '管理员账号或密码不正确，无法查看明文' });
  }
  audit(req.user.username, '查看明文密码', `${acc.account}（通过管理员 ${admin.username} 验证）`);
  const plain = decPassword(acc.password_enc);
  return plain === null
    ? res.status(500).json({ error: '解密失败' })
    : res.json({ password: plain });
});

/* ================= 权限变更记录 ================= */
api.get('/records', authRequired, (req, res) => {
  const isAdmin = req.user.role === '管理员';
  const granted = isAdmin ? null : JSON.parse(stmts.findUser.get(req.user.username)?.assets || '[]');
  const rows = stmts.listRecords.all();
  let out = rows.map((r) => ({
    ...r,
    executions: stmts.listExecs.all(r.id),
  }));
  if (!isAdmin) out = out.filter((r) => !r.asset_id || granted.includes(r.asset_id));
  res.json({ records: out });
});

api.post('/records', authRequired, (req, res) => {
  const { applicant, assetId, requirement } = req.body;
  // 普通用户：目标资产必须在其授权范围内；管理员可选任意
  if (req.user.role !== '管理员' && assetId) {
    if (!assertAssetAccess(req, res, assetId)) return;
  }
  const id = uid('r');
  stmts.insertRecord.run(id, applicant, assetId || '', requirement, '待处理', nowText());
  audit(req.user.username, '新增权限变更需求', `${applicant}：${String(requirement).slice(0, 40)}`);
  res.json({ ok: true, id });
});

api.delete('/records/:id', authRequired, adminOnly, (req, res) => {
  const r = stmts.findRecord.get(req.params.id);
  if (!r) return res.status(404).json({ error: '需求单不存在' });
  stmts.delExecsOfRecord.run(r.id);
  stmts.delRecord.run(r.id);
  audit(req.user.username, '删除需求单', `${r.applicant}：${String(r.requirement).slice(0, 40)}`);
  res.json({ ok: true });
});

/* 执行结果：status=完成|中止，写入 executions 并更新需求单状态，审计留痕 */
api.post('/records/:id/execute', authRequired, adminOnly, (req, res) => {
  const r = stmts.findRecord.get(req.params.id);
  if (!r) return res.status(404).json({ error: '需求单不存在' });
  const { status, result } = req.body;
  if (!['完成', '中止'].includes(status)) return res.status(400).json({ error: '状态不合法' });
  const id = uid('e');
  const text = status === '完成' ? String(result || '').trim() : `执行中止：${String(result || '').trim()}`;
  stmts.insertExec.run(id, r.id, text, req.user.username, nowText());
  stmts.setRecordStatus.run(status, r.id);
  audit(req.user.username, status === '完成' ? '权限变更执行完成' : '权限变更执行中止', `${r.applicant}：${String(r.requirement).slice(0, 40)}`);
  res.json({ ok: true, id, status });
});

/* 打开执行窗口即置为处理中（其他人员实时可见） */
api.post('/records/:id/start', authRequired, adminOnly, (req, res) => {
  const r = stmts.findRecord.get(req.params.id);
  if (!r) return res.status(404).json({ error: '需求单不存在' });
  if (r.status !== '处理中') {
    stmts.setRecordStatus.run('处理中', r.id);
    audit(req.user.username, '开始执行', `${r.applicant}：${String(r.requirement).slice(0, 40)}`);
  }
  res.json({ ok: true });
});

/* ================= 账号管理（仅管理员） ================= */
api.get('/users', authRequired, adminOnly, (_req, res) => {
  const users = stmts.listUsers.all().map((u) => ({
    username: u.username,
    role: u.role,
    assets: JSON.parse(u.assets || '[]'),
    createdAt: u.created_at,
  }));
  res.json({ users });
});

api.post('/users', authRequired, adminOnly, (req, res) => {
  const { username, password, role, assetIds } = req.body;
  const exist = stmts.findUser.get(String(username || '').trim());
  if (exist) return res.status(409).json({ error: '账号已存在' });
  const hash = bcrypt.hashSync(String(password), 10);
  const assets = role === '管理员' ? [] : assetIds || [];
  stmts.insertUser.run(String(username).trim(), hash, role, JSON.stringify(assets), nowText());
  audit(req.user.username, '新增账号', `${username}（${role}）`);
  res.json({ ok: true });
});

api.delete('/users/:username', authRequired, adminOnly, (req, res) => {
  const u = stmts.findUser.get(req.params.username);
  if (!u) return res.status(404).json({ error: '账号不存在' });
  const n = stmts.delUser.run(u.username).changes;
  if (n === 0) return res.status(403).json({ error: '内置 admin 账号不可删除' });
  audit(req.user.username, '删除账号', u.username);
  res.json({ ok: true });
});

api.put('/users/:username/assets', authRequired, adminOnly, (req, res) => {
  const u = stmts.findUser.get(req.params.username);
  if (!u) return res.status(404).json({ error: '账号不存在' });
  const next = u.role === '管理员' ? [] : req.body.assetIds || [];
  stmts.setUserAssets.run(JSON.stringify(next), u.username);
  audit(req.user.username, '调整授权资产', `${u.username} → ${next.length === 0 ? '全部资产' : next.map((id) => loadAsset(id)?.name || id).join('、')}`);
  res.json({ ok: true });
});

api.put('/users/:username/password', authRequired, adminOnly, (req, res) => {
  const u = stmts.findUser.get(req.params.username);
  if (!u) return res.status(404).json({ error: '账号不存在' });
  stmts.setUserPass.run(bcrypt.hashSync(String(req.body.password || ''), 10), u.username);
  audit(req.user.username, '重置账号密码', u.username);
  res.json({ ok: true });
});

/* ================= 审计日志（仅管理员查询；服务端只增不删） ================= */
api.get('/audit', authRequired, adminOnly, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  res.json({ audit: stmts.listAudit.all(limit) });
});
