// 构建 Linux 绿色版 tar.gz（Windows 上替代 electron-builder/bsdtar，保证可执行位 0755）
// 用法：node scripts/pack-linux-tar.mjs   （前提：已运行 npx electron-builder --linux，产出 release/linux-unpacked）
// 原理：Windows 文件系统没有 Unix 执行位，bsdtar/electron-builder 打出的 tar.gz 中
// 主程序等可执行文件均为 0666，Linux 解压后 ./db-asset-management 报 Permission denied。
// 本脚本按 ustar 标准逐块生成 tar 字节流（显式权限位 + 逐头校验和 + 双零块结尾），
// 附带顶层 run.sh 启动脚本（含 chmod 兜底），并做逐头校验和自检。
// 验证：用 GNU tar / bsdtar 解压后 sh run.sh 即可运行；沙箱报错可加 --no-sandbox。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const release = path.join(root, 'release');
const SRC = path.join(release, 'linux-unpacked');
const OUT = path.join(release, 'db-asset-management-linux-x64.tar.gz');
const EXE = new Set(['db-asset-management', 'chrome_crashpad_handler', 'chrome-sandbox']);

if (!fs.existsSync(SRC)) {
  console.error('未找到 ' + SRC + '，请先运行: npx electron-builder --linux');
  process.exit(1);
}

const RUN_SH = [
  '#!/bin/sh',
  '# 数据库资产设备管理 - Linux 绿色版启动脚本',
  '# 用法：tar -xzf db-asset-management-linux-x64.tar.gz && sh run.sh',
  '# 若提示 sandbox 相关错误：sh run.sh --no-sandbox',
  'cd "$(dirname "$0")"',
  'chmod +x linux-unpacked/db-asset-management linux-unpacked/chrome_crashpad_handler linux-unpacked/chrome-sandbox 2>/dev/null || true',
  'exec ./linux-unpacked/db-asset-management "$@"',
  '',
].join('\n');

/* ---------- 收集条目（先 run.sh，再 linux-unpacked 目录树） ---------- */
const entries = [];
function walk(rel) {
  const full = path.join(SRC, rel);
  const st = fs.statSync(full);
  if (st.isDirectory()) {
    const p = rel === '' ? 'linux-unpacked' : 'linux-unpacked/' + rel.split(path.sep).join('/');
    entries.push({ p, dir: true });
    for (const c of fs.readdirSync(full).sort()) walk(rel === '' ? c : rel + '/' + c);
  } else {
    entries.push({ p: 'linux-unpacked/' + rel.split(path.sep).join('/'), file: full });
  }
}
walk('');
entries.unshift({ p: 'run.sh', data: Buffer.from(RUN_SH, 'utf8') });
console.log('entries collected:', entries.length);

/* ---------- ustar 头（显式权限位 + 逐头校验和） ---------- */
function buildHeader(entry, size) {
  const h = Buffer.alloc(512);
  // name/prefix 拆分（name<=100, prefix<=155；本项目最长路径 127，无需 PAX）
  let name, prefix = '';
  if (entry.p.length <= 100) name = entry.p;
  else {
    let idx = entry.p.lastIndexOf('/', 99);
    if (idx <= 0) idx = entry.p.lastIndexOf('/');
    name = entry.p.slice(idx + 1);
    prefix = entry.p.slice(0, idx);
    if (name.length > 100 || prefix.length > 155) throw new Error('path too long: ' + entry.p);
  }
  // 权限位：目录 0755；run.sh 0755；三个可执行文件 0755；其余 0644
  const m2 = entry.dir ? 0o755 : (entry.data ? 0o755 : (EXE.has(name.split('/').pop()) ? 0o755 : 0o644));
  h.write(name, 0, 'latin1');
  h.write(m2.toString(8), 100, 'latin1');
  h.write('0', 108, 'latin1');  // uid
  h.write('0', 116, 'latin1');  // gid
  h.write(size.toString(8), 124, 'latin1');
  h.write('0', 136, 'latin1');  // mtime
  h.fill(0x20, 148, 156);       // 校验和先按 8 空格计
  h.write(entry.dir ? '5' : '0', 156, 'latin1');
  if (prefix) h.write(prefix, 345, 'latin1');
  h.write('ustar\0', 257, 'latin1');
  h.write('00', 263, 'latin1');
  h.write('root', 265, 'latin1');
  h.write('root', 297, 'latin1');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum = (sum + h[i]) >>> 0;
  h.write(sum.toString(8).padStart(6, '0'), 148, 'latin1'); // 写回校验和
  return h;
}

/* ---------- 拼装 ---------- */
const chunks = [];
for (const e of entries) {
  let data = e.data ? e.data : (e.file ? fs.readFileSync(e.file) : Buffer.alloc(0));
  const header = buildHeader(e, data.length);
  chunks.push(header, data);
  if (data.length % 512) chunks.push(Buffer.alloc(512 - (data.length % 512)));
}
chunks.push(Buffer.alloc(1024)); // 双零块结尾
const tarBytes = Buffer.concat(chunks);
const gz = zlib.gzipSync(tarBytes, { level: 9 });
fs.writeFileSync(OUT, gz);
console.log('packed ->', OUT, gz.length, 'bytes (tar raw ' + tarBytes.length + ')');

/* ---------- 自检：按 size 步进逐头重算校验和 + 权限位核对 ---------- */
function oct(h, s, e) {
  let t = '';
  for (let i = s; i < e; i++) { if (h[i] === 0) break; t += String.fromCharCode(h[i]); }
  return t ? parseInt(t, 8) : 0;
}
let off = 0, bad = 0, n = 0;
const execSeen = {};
while (off + 512 <= tarBytes.length) {
  const h = tarBytes.subarray(off, off + 512);
  if (h.every((b) => b === 0)) break;
  const tf = String.fromCharCode(h[156]);
  let nm = '';
  for (let i = 0; i < 100; i++) { if (h[i] === 0) break; nm += String.fromCharCode(h[i]); }
  let pf = '';
  for (let i = 345; i < 500; i++) { if (h[i] === 0) break; pf += String.fromCharCode(h[i]); }
  if (pf) nm = pf + '/' + nm;
  const size = tf === '5' ? 0 : oct(h, 124, 136);
  // 重算校验和
  const saved = [];
  for (let i = 148; i < 156; i++) { saved[i] = h[i]; h[i] = 0x20; }
  let s2 = 0;
  for (let i = 0; i < 512; i++) s2 = (s2 + h[i]) >>> 0;
  let stored = 0;
  for (let i = 148; i < 154; i++) { const d = saved[i]; if (d === 0x20 || d === 0x00) continue; stored = stored * 8 + (d - 0x30); }
  if (stored !== s2) { bad++; if (bad < 5) console.log('BAD CHKSUM', nm, stored, s2); }
  if (tf === '0') {
    const base = nm.split('/').pop();
    if (EXE.has(base)) execSeen[base] = (oct(h, 100, 108) & 0o777).toString(8);
  }
  n++;
  off += 512 + ((size + 511) & ~511);
}
console.log('headers checked:', n, 'bad:', bad, '| exec modes =', JSON.stringify(execSeen));
const ok = bad === 0 && Object.keys(execSeen).length === 3
  && Object.values(execSeen).every((m) => m === '755');
console.log(ok ? 'PACK-LINUX: PASS' : 'PACK-LINUX: FAIL');
process.exit(ok ? 0 : 1);
