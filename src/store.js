import { useSyncExternalStore } from 'react';

/* 向后兼容：各页面仍从 store 导入共享常量与配色 */
export {
  OFFICIAL_DB_VERSIONS,
  DEFAULT_PORT,
  DEFAULT_CONFIG,
  DB_TYPE_COLORS,
  DB_TYPE_COLOR_FALLBACK,
  ENV_COLOR,
} from './constants.js';

/* ============================================================
 * 前端数据层：所有数据经由后端 API（/api/*）获取与修改
 *  - 认证：JWT（存 sessionStorage，401 自动触发登出）
 *  - 权限：服务端按角色/授权资产强制过滤，前端过滤只是展示
 *  - 密码：服务端 AES-256-GCM 加密存储，列表接口永不返回明文；
 *          明文仅通过 /accounts/:id/reveal 校验管理员后取得
 *  - 审计：服务端 audit_log 只增不删，前端只读查询
 * ============================================================ */

const TOKEN_KEY = 'db-asset-token';
export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  sessionStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

let data = {
  assets: [],
  changeRecords: [],
  config: {},
  users: [],
  audit: [],
  ready: false,
};
const listeners = new Set();
function emit() {
  data = { ...data };
  listeners.forEach((fn) => fn());
}

let unauthorizedHandler = null;
export function onUnauthorized(fn) {
  unauthorizedHandler = fn;
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (res.status === 401) {
    clearToken();
    unauthorizedHandler?.();
    throw new ApiError(401, payload?.error || '登录已过期，请重新登录');
  }
  if (!res.ok) {
    throw new ApiError(res.status, payload?.error || `请求失败（${res.status}）`);
  }
  return payload;
}

/* ---------- 登录 / 拉取个人数据快照 ---------- */
export async function login(username, password) {
  const r = await api('/login', { method: 'POST', body: { username, password }, auth: false });
  setToken(r.token);
  data = { ...data, user: r.user };
  await refreshBootstrap();
  return r.user;
}

export async function refreshBootstrap() {
  const b = await api('/bootstrap');
  data.user = b.user || data.user;
  data.assets = b.assets;
  data.changeRecords = b.records;
  data.config = b.config;
  data.ready = true;
  emit();
  return data.user;
}

export async function refreshUsers() {
  data.users = (await api('/users')).users;
  emit();
}

export async function refreshAudit(limit = 200) {
  data.audit = (await api(`/audit?limit=${limit}`)).audit;
  emit();
}

/* ---------- 资产设备 ---------- */
export async function addAsset(payload) {
  const r = await api('/assets', { method: 'POST', body: { payload } });
  await refreshBootstrap();
  return r.asset;
}

export async function deleteAsset(id) {
  await api(`/assets/${id}`, { method: 'DELETE' });
  await refreshBootstrap();
}

/* 修改资产使用状态（在线/离线/维护等），仅管理员 */
export async function updateAssetStatus(id, status) {
  await api(`/assets/${id}/status`, { method: 'PUT', body: { status } });
  await refreshBootstrap();
}

export async function addDatabase(assetId, { dbType = 'Oracle', dbVersion = '', port = '', dbIsDocker = false }) {
  const r = await api(`/assets/${assetId}/databases`, {
    method: 'POST',
    body: { dbType, dbVersion, port, dbIsDocker },
  });
  await refreshBootstrap();
  return r.dbId;
}

export async function updateDatabase(dbId, { dbType, dbVersion, port, dbIsDocker }) {
  await api(`/databases/${dbId}`, { method: 'PUT', body: { dbType, dbVersion, port, dbIsDocker } });
  await refreshBootstrap();
}

export async function removeDatabase(dbId) {
  await api(`/databases/${dbId}`, { method: 'DELETE' });
  await refreshBootstrap();
}

/* ---------- 账号（服务端加密；列表不返回明文） ---------- */
export async function addAccount({ assetId, kind, refId = null, account, password }) {
  const r = await api('/accounts', {
    method: 'POST',
    body: { assetId, kind, refId, account, password },
  });
  await refreshBootstrap();
  return r.id;
}

export async function deleteAccount(id) {
  await api(`/accounts/${id}`, { method: 'DELETE' });
  await refreshBootstrap();
}

/* 查看明文：普通用户需提交管理员账号密码由服务端校验；管理员直接校验身份。
 * 成功返回明文，失败抛出带错误信息的异常（服务端已审计）。 */
export async function revealPassword(accountId, adminUsername, adminPassword) {
  const r = await api(`/accounts/${accountId}/reveal`, {
    method: 'POST',
    body: { adminUsername, adminPassword },
  });
  return r.password;
}

/* ---------- 权限变更记录 ---------- */
export async function addRecord({ applicant, assetId, requirement }) {
  const r = await api('/records', { method: 'POST', body: { applicant, assetId, requirement } });
  await refreshBootstrap();
  return r.id;
}

export async function deleteRecord(id) {
  await api(`/records/${id}`, { method: 'DELETE' });
  await refreshBootstrap();
}

/* 打开执行窗口：服务端置为「处理中」（其他人员实时可见） */
export async function startRecord(id) {
  await api(`/records/${id}/start`, { method: 'POST', body: {} });
  await refreshBootstrap();
}

/* 完成 / 中止：写入执行结果并更新状态 */
export async function executeRecord(id, status, result) {
  await api(`/records/${id}/execute`, { method: 'POST', body: { status, result } });
  await refreshBootstrap();
}

/* ---------- 配置管理（仅管理员可写） ---------- */
export async function saveConfig(config) {
  const r = await api('/config', { method: 'PUT', body: { config } });
  data.config = r.config;
  emit();
  return r.config;
}

export async function syncOfficialVersions() {
  const r = await api('/config/sync-official', { method: 'POST', body: {} });
  data.config = r.config;
  emit();
  return r.changed;
}

/* ---------- 账号管理（仅管理员） ---------- */
export async function addUser({ username, password, role, assetIds = [] }) {
  await api('/users', { method: 'POST', body: { username, password, role, assetIds } });
  await refreshUsers();
  await refreshAudit();
}

export async function deleteUser(username) {
  await api(`/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
  await refreshUsers();
  await refreshAudit();
}

export async function setUserAssets(username, assetIds) {
  await api(`/users/${encodeURIComponent(username)}/assets`, {
    method: 'PUT',
    body: { assetIds },
  });
  await refreshUsers();
  await refreshAudit();
}

export async function resetUserPassword(username, password) {
  await api(`/users/${encodeURIComponent(username)}/password`, {
    method: 'PUT',
    body: { password },
  });
  await refreshAudit();
}

/* ---------- 登出 / 重置 ---------- */
export async function logout() {
  try {
    await api('/logout', { method: 'POST', body: {} });
  } catch {
    /* token 已失效时忽略 */
  }
  clearToken();
  resetData();
}

export function resetData() {
  data = { assets: [], changeRecords: [], config: {}, users: [], audit: [], ready: false, user: null };
  emit();
}

/* ---------- 响应式订阅（保持与旧版一致的 hook） ---------- */
export function useAppData() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => data
  );
}
