import express from 'express';
import { api } from './routes.js';
import { seedIfEmpty } from './seed.js';

// 首次启动（数据库为空）时写入种子数据
seedIfEmpty();

const app = express();
app.use(express.json());
app.use('/api', api);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[DB Asset Management API] 后端服务已启动 http://localhost:${PORT}`);
});
