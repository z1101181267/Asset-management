// 构建「网页端」部署包（浏览器访问：Node 后端 + 静态前端）
// 用法：node scripts/pack-web.mjs
// 产物：
//   release/DB-Asset-Management-Web-Windows-<ver>.zip   （含便携 node.exe，离线直接双击 start-web.bat）
//   release/db-asset-management-web-linux-x64.tar.gz    （含 start-web.sh；可选内嵌 node，默认要求系统 Node ≥ 22）
// 结构：
//   db-asset-management-web/
//     dist/            前端静态资源（生产构建）
//     server/          Express + node:sqlite 后端（API 路由/数据层/鉴权/审计）
//     src/constants.js 后端引用的共享常量
//     node_modules/   仅运行时 3 个纯 JS 依赖及其闭包（express/bcryptjs/jsonwebtoken）
//     package.json     type=module，main=server/index.js
//     start-web.bat / start-web.sh / node(.exe|可选)
//     data/            首次运行自动创建（SQLite 数据库 + JWT 密钥 + 字段加密密钥）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const release = path.join(root, 'release');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const PKG_NAME = 'db-asset-management-web';
const buildDir = path.join(release, 'web-build', PKG_NAME);
const DEPS = ['express', 'bcryptjs', 'jsonwebtoken'];

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('未找到 dist/，请先运行: npx vite build');
  process.exit(1);
}

/* ---------- 1) 收集最小依赖闭包（顶层 node_modules BFS） ---------- */
const topNM = path.join(root, 'node_modules');
function closure() {
  const set = new Set(DEPS);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of [...set]) {
      const pj = path.join(topNM, p, 'package.json');
      if (!fs.existsSync(pj)) continue;
      const j = JSON.parse(fs.readFileSync(pj, 'utf8'));
      for (const dep of Object.keys({ ...((j.dependencies) || {}), ...((j.optionalDependencies) || {}) })) {
        if (dep.startsWith('@')) continue;
        if (!set.has(dep) && fs.existsSync(path.join(topNM, dep))) { set.add(dep); grew = true; }
      }
    }
  }
  return [...set].sort();
}
const deps = closure();
console.log('dependency closure (' + deps.length + '):', deps.join(', '));

/* ---------- 2) 组装包目录 ---------- */
fs.rmSync(path.join(release, 'web-build'), { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });

function copyDir(src, dest) { fs.cpSync(src, dest, { recursive: true }); }
copyDir(path.join(root, 'dist'), path.join(buildDir, 'dist'));
copyDir(path.join(root, 'server'), path.join(buildDir, 'server'));
fs.mkdirSync(path.join(buildDir, 'src'), { recursive: true });
fs.copyFileSync(path.join(root, 'src', 'constants.js'), path.join(buildDir, 'src', 'constants.js'));
fs.mkdirSync(path.join(buildDir, 'node_modules'), { recursive: true });
for (const p of deps) copyDir(path.join(topNM, p), path.join(buildDir, 'node_modules', p));

// 精简 package.json（仅运行时依赖）
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify({
  name: pkg.name, version: pkg.version, description: pkg.description,
  type: 'module', main: 'server/index.js',
  scripts: { start: 'node server/index.js' },
  dependencies: Object.fromEntries(DEPS.map((d) => [d, pkg.dependencies[d]])),
}, null, 2) + '\n');

// Windows 启动脚本
const bat = [
  '@echo off',
  'chcp 65001 >nul',
  'rem 数据库资产设备管理 - 网页端启动脚本 (Windows)',
  'rem 用法：双击 start-web.bat，浏览器访问 http://127.0.0.1:3001（可用 set PORT=8080 自定义）',
  'cd /d "%~dp0"',
  'set PORT=%PORT%',
  'if not defined PORT set PORT=3001',
  'if exist "node.exe" (',
  '  echo [1/2] 内嵌便携 Node 检测通过',
  '  "node.exe" -v',
  ') else (',
  '  where node >nul 2>nul',
  '  if errorlevel 1 (',
  '    echo 未找到 Node.js。本包应含 node.exe；若缺失请安装 Node.js ^>^= 22 后重试。',
  '    pause & exit /b 1',
  '  )',
  ')',
  'echo [2/2] 启动后端服务 http://127.0.0.1:%PORT%  (数据目录: %~dp0data\\ )',
  'if exist "node.exe" ( "node.exe" server\\index.js ) else ( node server\\index.js )',
  'pause',
  '',
].join('\r\n');
fs.writeFileSync(path.join(buildDir, 'start-web.bat'), bat);

// Linux 启动脚本
const sh = [
  '#!/bin/sh',
  '# 数据库资产设备管理 - 网页端启动脚本 (Linux)',
  '# 用法：解压后执行  sh start-web.sh   （浏览器访问 http://127.0.0.1:3001）',
  '# 可通过环境变量自定义端口：PORT=8080 sh start-web.sh',
  '# 要求：内嵌 node 或 系统 Node.js >= 22（node:sqlite 内置）',
  'cd "$(dirname "$0")"',
  'PORT="${PORT:-3001}"',
  'export PORT',
  'if [ -x ./node ]; then',
  '  echo "[1/2] 内嵌 Node: $(./node -v)"',
  '  NODE=./node',
  'else',
  '  if ! command -v node >/dev/null 2>&1; then',
  '    echo "未找到 Node.js，请安装 Node.js >= 22 后重试（https://nodejs.org 或 nvm）"; exit 1',
  '  fi',
  '  echo "[1/2] 系统 Node: $(node -v)"',
  '  NODE=node',
  'fi',
  'echo "[2/2] 启动后端服务 http://127.0.0.1:$PORT （数据目录: ./data/）"',
  'exec $NODE server/index.js',
  '',
].join('\n');
fs.writeFileSync(path.join(buildDir, 'start-web.sh'), sh);

// 使用说明
const readme = [
  '数据库资产设备管理 - 网页端 v' + version,
  '',
  '运行：',
  '  Windows: 解压后双击 start-web.bat',
  '  Linux:   tar -xzf db-asset-management-web-linux-x64.tar.gz && sh db-asset-management-web/start-web.sh',
  '浏览器访问 http://127.0.0.1:3001 （PORT 环境变量可自定义端口）',
  '',
  '演示账号：admin / admin123（管理员）、zhangsan / 123456（普通用户）',
  '',
  '数据与密钥：首次启动自动在 ./data/ 创建 SQLite 数据库、JWT 密钥与字段加密密钥（AES-256-GCM）。',
  '备份 ./data/ 即完成数据迁移。',
  '',
  'Windows 包内嵌便携 node.exe（Node v24，离线可用）；Linux 包默认使用系统 Node.js（需 >= 22）。',
  '',
].join('\n');
fs.writeFileSync(path.join(buildDir, 'README.txt'), readme);

/* ---------- 3) Windows：复制便携 node.exe，打 zip ---------- */
const nodeExe = process.env.NODE_EXE_WIN || 'C:\\Program Files\\nodejs\\node.exe';
if (fs.existsSync(nodeExe)) {
  fs.copyFileSync(nodeExe, path.join(buildDir, 'node.exe'));
  console.log('bundled node.exe:', fs.statSync(path.join(buildDir, 'node.exe')).length, 'bytes');
} else {
  console.error('未找到便携 node.exe（' + nodeExe + '），Windows 包将不含内嵌 Node');
}
const winZip = path.join(release, `DB-Asset-Management-Web-Windows-${version}.zip`);
if (fs.existsSync(winZip)) fs.rmSync(winZip);
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${path.join(release, 'web-build', PKG_NAME)}\\*' -DestinationPath '${winZip}' -Force"`, { stdio: 'inherit' });
console.log('windows zip:', winZip, fs.statSync(winZip).size, 'bytes');

/* ---------- 4) Linux：可选内嵌 node，ustar tar.gz（显式权限位 + 校验和） ---------- */
// 若 release/web-node-linux/node 存在（预下载的 Linux node 二进制），内嵌之
const linuxNodeDir = path.join(release, 'web-node-linux');
let linuxNode = null;
if (fs.existsSync(path.join(linuxNodeDir, 'node'))) linuxNode = path.join(linuxNodeDir, 'node');

function buildHeader(entry, size) {
  const h = Buffer.alloc(512);
  let name, prefix = '';
  if (entry.p.length <= 100) name = entry.p;
  else {
    let idx = entry.p.lastIndexOf('/', 99);
    if (idx <= 0) idx = entry.p.lastIndexOf('/');
    name = entry.p.slice(idx + 1);
    prefix = entry.p.slice(0, idx);
  }
  const EXE_BASE = new Set(['start-web.sh', 'node']);
  const mode = entry.dir ? 0o755 : (entry.data ? 0o755 : (EXE_BASE.has(path.posix.basename(name)) ? 0o755 : 0o644));
  h.write(name, 0, 'latin1');
  h.write(mode.toString(8), 100, 'latin1');
  h.write('0', 108, 'latin1');
  h.write('0', 116, 'latin1');
  h.write(size.toString(8), 124, 'latin1');
  h.write('0', 136, 'latin1');
  h.fill(0x20, 148, 156);
  h.write(entry.dir ? '5' : '0', 156, 'latin1');
  if (prefix) h.write(prefix, 345, 'latin1');
  h.write('ustar\0', 257, 'latin1');
  h.write('00', 263, 'latin1');
  h.write('root', 265, 'latin1');
  h.write('root', 297, 'latin1');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum = (sum + h[i]) >>> 0;
  h.write(sum.toString(8).padStart(6, '0'), 148, 'latin1');
  return h;
}

const lentries = [];
function walkLinux(rel, isTopNode = false) {
  // 遍历包目录，前缀 db-asset-management-web/
  const full = path.join(buildDir, rel);
  const st = fs.statSync(full);
  const p = 'db-asset-management-web/' + rel.split(path.sep).join('/');
  if (st.isDirectory()) {
    lentries.push({ p, dir: true });
    for (const c of fs.readdirSync(full).sort()) walkLinux(rel ? rel + '/' + c : c);
  } else {
    lentries.push({ p, file: full, exec: isTopNode || path.posix.basename(p) === 'start-web.sh' });
  }
}
walkLinux('');
// 内嵌 Linux node（可选）
if (linuxNode) {
  lentries.push({ p: 'db-asset-management-web/node', file: linuxNode, exec: true });
  console.log('bundling Linux node binary:', linuxNode);
}

const chunks = [];
for (const e of lentries) {
  const data = e.dir ? Buffer.alloc(0) : fs.readFileSync(e.file);
  const header = buildHeader(e, data.length);
  chunks.push(header, data);
  if (data.length % 512) chunks.push(Buffer.alloc(512 - (data.length % 512)));
}
chunks.push(Buffer.alloc(1024));
const tarBytes = Buffer.concat(chunks);

// 自检：逐头校验和 + 执行位
function oct(h, s, e) { let t = ''; for (let i = s; i < e; i++) { if (h[i] === 0) break; t += String.fromCharCode(h[i]); } return t ? parseInt(t, 8) : 0; }
let off = 0, bad = 0, execSeen = {};
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
  const saved = [];
  for (let i = 148; i < 156; i++) { saved[i] = h[i]; h[i] = 0x20; }
  let s2 = 0;
  for (let i = 0; i < 512; i++) s2 = (s2 + h[i]) >>> 0;
  let stored = 0;
  for (let i = 148; i < 154; i++) { const d = saved[i]; if (d === 0x20 || d === 0) continue; stored = stored * 8 + (d - 0x30); }
  if (stored !== s2) bad++;
  if (tf === '0' && ['start-web.sh', 'node'].includes(nm.split('/').pop()))
    execSeen[nm] = (oct(h, 100, 108) & 0o777).toString(8);
  off += 512 + ((size + 511) & ~511);
}
if (bad) { console.error('tar header checksum errors:', bad); process.exit(1); }
console.log('linux tar checksums OK | exec modes =', JSON.stringify(execSeen));

const linuxTar = path.join(release, `db-asset-management-web-linux-x64.tar.gz`);
fs.writeFileSync(linuxTar, zlib.gzipSync(tarBytes, { level: 9 }));
console.log('linux tar.gz:', linuxTar, fs.statSync(linuxTar).size, 'bytes');
console.log('PACK-WEB: PASS');
