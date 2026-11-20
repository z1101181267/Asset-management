import * as XLSX from 'xlsx';

/* 资产设备管理 —— Excel 导入/导出工具（.xlsx / .csv）
 * 导出：基础列 + 服务器账号 + 每套数据库列组（类型/版本/端口/是否Docker/账号/密码，多组账号用 ; 对齐）
 *       「是否Docker」已下沉到数据库级，随「数据库N」列组输出，不再有资产级 Docker 列
 * 导入：按同结构解析，重建 payload 交 addAsset（服务端 AES 加密存储）
 */

const BASE_HEADERS = [
  '设备名称', 'IP', '环境类型', '所属公司', '负责人', '使用状态',
  '服务器账号', '服务器密码',
];

const pad2 = (n) => String(n).padStart(2, '0');

/* 多组账号/密码按 ; 拆分并对齐：账号非空且密码非空才保留（避免导入产生空密码账号） */
function splitPairs(accountText, passwordText) {
  const accs = String(accountText || '').split(';').map((s) => s.trim()).filter(Boolean);
  const pws = String(passwordText || '').split(';').map((s) => s.trim());
  const out = [];
  accs.forEach((acc, i) => {
    const pwd = (pws[i] || '').trim();
    if (acc && pwd) out.push({ account: acc, password: pwd });
  });
  return out;
}

/* 数据库列组表头（N 套） */
function dbGroupHeaders(maxDb) {
  const hs = [];
  for (let i = 0; i < maxDb; i++) {
    hs.push(
      `数据库${i + 1}类型`, `数据库${i + 1}版本`, `数据库${i + 1}端口`,
      `数据库${i + 1}是否Docker`, `数据库${i + 1}账号`, `数据库${i + 1}密码`
    );
  }
  return hs;
}

function buildRows(assets) {
  const maxDb = assets.reduce((m, a) => Math.max(m, (a.databases || []).length), 0);
  const headers = [...BASE_HEADERS, ...dbGroupHeaders(maxDb)];
  // AOA：表头行 + 数据行，显式保证数据库列组一定输出（不依赖 json_to_sheet 的列推断）
  const data = assets.map((a) => {
    const base = [
      a.name || '',
      a.ip || '',
      a.envType || '',
      a.company || '',
      a.owner || '',
      a.status || '在线',
      (a.serverAccounts || []).map((x) => x.account).join(';'),
      (a.serverAccounts || []).map((x) => x._plain || '').join(';'),
    ];
    const dbs = a.databases || [];
    const dbCells = [];
    for (let i = 0; i < maxDb; i++) {
      const db = dbs[i];
      if (db) {
        const accs = db.dbAccounts || [];
        dbCells.push(
          db.dbType || '',
          db.dbVersion || '',
          db.port || '',
          db.dbIsDocker ? '是' : '否',
          accs.map((x) => x.account).join(';'),
          accs.map((x) => x._plain || '').join(';')
        );
      } else {
        dbCells.push('', '', '', '', '', '');
      }
    }
    return [...base, ...dbCells];
  });
  return { headers, data: [headers, ...data], maxDb };
}

/* 导出：先逐条取明文密码（reveal），再写 xlsx 并触发下载 */
export async function exportAssetsToExcel(assets, reveal) {
  for (const a of assets) {
    for (const acc of a.serverAccounts || []) {
      try {
        acc._plain = await reveal(acc.id);
      } catch {
        acc._plain = '（解密失败）';
      }
    }
    for (const db of a.databases || []) {
      for (const acc of db.dbAccounts || []) {
        try {
          acc._plain = await reveal(acc.id);
        } catch {
          acc._plain = '（解密失败）';
        }
      }
    }
  }
  const { headers, data, maxDb } = buildRows(assets);
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length * 2, 12) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '资产设备');
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  XLSX.writeFile(wb, `资产设备-${dateStr}.xlsx`);
  return { count: assets.length, maxDb, headers };
}

/* 导入：解析 Excel 文件 → payload 数组（结构与 addAsset 一致） */
export async function parseExcelImport(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const payloads = [];
  for (const row of rows) {
    const name = String(row['设备名称'] || '').trim();
    if (!name) continue;
    const databases = [];
    for (let i = 1; ; i++) {
      const t = String(row[`数据库${i}类型`] || '').trim();
      if (!t) break;
      databases.push({
        dbType: t,
        dbVersion: String(row[`数据库${i}版本`] || '').trim(),
        port: String(row[`数据库${i}端口`] || '').trim(),
        dbIsDocker: String(row[`数据库${i}是否Docker`] || row[`数据库${i}Docker`] || '').trim() === '是',
        dbAccounts: splitPairs(row[`数据库${i}账号`], row[`数据库${i}密码`]),
      });
    }
    payloads.push({
      name,
      ip: String(row['IP'] || '').trim(),
      envType: String(row['环境类型'] || '').trim(),
      isDocker: String(row['是否Docker'] || '').trim() === '是', // 兼容旧文件；新导出无此列
      owner: String(row['负责人'] || '').trim(),
      company: String(row['所属公司'] || '').trim(),
      databases,
      serverAccounts: splitPairs(row['服务器账号'], row['服务器密码']),
    });
  }
  return payloads;
}
