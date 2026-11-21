import { createApp } from './app.js';

// 网页端启动入口：API + 静态前端（dist/）+ SPA 回退
// - 数据与密钥：DB_DATA_DIR 环境变量，或默认 ./data（首次启动自动创建并写种子数据）
// - 监听地址：WEB_HOST 环境变量（默认 0.0.0.0，局域网/远程可访问）；PORT 默认 3001
const app = createApp();
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.WEB_HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`[DB Asset Management Web] 网页端已启动`);
  console.log(`  本机访问:  http://127.0.0.1:${PORT}`);
  console.log(`  局域网:    http://<本机IP>:${PORT}   （需防火墙放行端口 ${PORT}）`);
  console.log(`  演示账号:  admin / admin123（管理员）、zhangsan / 123456（普通用户）`);
});
