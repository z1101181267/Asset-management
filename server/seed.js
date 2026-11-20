import bcrypt from 'bcryptjs';
import { stmts, encPassword } from './db.js';
import { DEFAULT_CONFIG } from '../src/constants.js';

const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export function seedIfEmpty() {
  const cnt = stmts.countUsers.get().n;
  if (cnt > 0) return false; // 已有数据，不重复种子

  // 配置
  stmts.setConfig.run('main', JSON.stringify(DEFAULT_CONFIG));

  // 用户（密码哈希存储）
  stmts.insertUser.run('admin', bcrypt.hashSync('admin123', 10), '管理员', '[]', now());
  stmts.insertUser.run('zhangsan', bcrypt.hashSync('123456', 10), '普通用户', '["a-1002"]', now());

  // 资产 1：Oracle
  stmts.insertAsset.run('a-1001', '核心业务库-Oracle01', '10.20.1.11', '正式', 0, '张工', '集团总部', now());
  stmts.insertDb.run('db-a1001-1', 'a-1001', 'Oracle', '19c', '1521', 0);
  stmts.insertAccount.run('d-1', 'a-1001', 'db', 'db-a1001-1', 'sys', encPassword('Sys#2026'));
  stmts.insertAccount.run('d-2', 'a-1001', 'db', 'db-a1001-1', 'app_user', encPassword('App@User1'));
  stmts.insertAccount.run('s-1', 'a-1001', 'server', null, 'root', encPassword('S@2026Core'));
  stmts.insertAccount.run('s-2', 'a-1001', 'server', null, 'oracle', encPassword('Or@cl3DB'));

  // 资产 2：MySQL（容器）
  stmts.insertAsset.run('a-1002', '测试环境-MySQL01', '10.20.2.21', '测试', 1, '李工', '华东子公司', now());
  stmts.insertDb.run('db-a1002-1', 'a-1002', 'MySQL', '8.0', '3306', 0);
  stmts.insertAccount.run('d-3', 'a-1002', 'db', 'db-a1002-1', 'root', encPassword('My#Root80'));
  stmts.insertAccount.run('s-3', 'a-1002', 'server', null, 'admin', encPassword('T3st@Adm'));

  // 需求单
  stmts.insertRecord.run('r-2001', '王工', 'a-1001', '为营销报表账号 rep_reader 授予核心库 SELECT 权限', '完成', now());
  stmts.insertExec.run('e-1', 'r-2001', '已创建账号并授权，验证通过。', 'admin', now());
  stmts.insertRecord.run('r-2002', '赵工', 'a-1002', '开通测试库 MySQL 8.0 应用账号 DDL 权限', '待处理', now());
  stmts.insertRecord.run('r-2003', '刘工', 'a-1001', 'KingBase 库迁移至新容器节点', '处理中', now());

  stmts.addAudit.run(now(), 'system', '初始化', '首次启动写入种子数据（演示账号 admin/admin123、zhangsan/123456）');
  console.log('[seed] 首次启动，已写入种子数据（演示账号 admin / admin123）');
  return true;
}
