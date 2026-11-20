import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { api } from './routes.js';
import { seedIfEmpty } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 创建 Express 应用（API + 生产静态资源 dist/ + SPA 回退）。
 * 首次启动（数据库为空）自动写入种子数据。
 */
export function createApp() {
  seedIfEmpty();

  const app = express();
  app.use(express.json());
  app.use('/api', api);

  // 生产构建的前端静态资源（打包后 dist 与 server 同级）
  const distDir = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    // SPA 回退：非 /api 的 GET 请求一律返回 index.html
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }
  return app;
}

/** 在指定端口（仅回环地址）启动服务 */
export function startServer(port) {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const srv = app.listen(port, '127.0.0.1', () => resolve(srv));
    srv.on('error', reject);
  });
}
