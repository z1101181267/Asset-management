// 前后端共享的常量：官方版本基线（截至 2026-11）、默认端口、标签配色
export const OFFICIAL_DB_VERSIONS = {
  Oracle: ['11.2.0.4', '12.1.0.2', '12.2.0.1', '18c', '19c', '21c', '23ai', '26ai'],
  MySQL: ['5.5', '5.6', '5.7', '8.0', '8.1', '8.2', '8.3', '8.4', '9.0', '9.1', '9.2', '9.3', '9.4', '9.5'],
  PostgreSQL: ['9.6', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19'],
  SqlServer: ['2005', '2008', '2008 R2', '2012', '2014', '2016', '2017', '2019', '2022', '2025'],
  KingBase: ['V8R6', 'V9'],
  Mongodb: ['3.6', '4.0', '4.2', '4.4', '5.0', '6.0', '7.0', '8.0', '8.1', '8.2', '8.3', '9.0'],
};

export const DEFAULT_PORT = {
  Oracle: '1521',
  MySQL: '3306',
  PostgreSQL: '5432',
  SqlServer: '1433',
  KingBase: '54321',
  Mongodb: '27017',
};

export const DEFAULT_CONFIG = {
  envTypes: ['正式', '测试', '开发'],
  dbTypes: ['Oracle', 'MySQL', 'PostgreSQL', 'SqlServer', 'KingBase', 'Mongodb'],
  dbVersions: {
    Oracle: [...OFFICIAL_DB_VERSIONS.Oracle],
    MySQL: [...OFFICIAL_DB_VERSIONS.MySQL],
    PostgreSQL: [...OFFICIAL_DB_VERSIONS.PostgreSQL],
    SqlServer: [...OFFICIAL_DB_VERSIONS.SqlServer],
    KingBase: ['V8R6', 'V9', '所有版本'],
    Mongodb: [...OFFICIAL_DB_VERSIONS.Mongodb],
  },
  ports: ['1521', '3306', '5432', '1433', '54321', '27017', '6361'],
  execStatus: ['待处理', '处理中', '中止', '完成'],
};

/* 高对比度数据库类型标签配色（深色底 + 白字） */
export const DB_TYPE_COLORS = {
  Oracle: { bg: '#E8590C', color: '#fff' },
  MySQL: { bg: '#1565C0', color: '#fff' },
  PostgreSQL: { bg: '#3F51B5', color: '#fff' },
  SqlServer: { bg: '#6A1B9A', color: '#fff' },
  KingBase: { bg: '#00838F', color: '#fff' },
  Mongodb: { bg: '#2E7D32', color: '#fff' },
};
export const DB_TYPE_COLOR_FALLBACK = { bg: '#455A74', color: '#fff' };
export const ENV_COLOR = { 正式: 'red', 测试: 'orange', 开发: 'blue' };
