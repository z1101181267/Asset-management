# 数据库资产设备管理（DB Asset Management）

基于 React + Vite + Ant Design 5 前端、Express + SQLite（`node:sqlite`）后端、Electron 桌面封装的企业级数据库资产设备管理平台。前后端一体打包为 Windows / Linux 桌面应用，双击即运行（内嵌随机端口本地服务，数据与密钥落在用户目录）。

## 功能模块

1. **登录界面**：企业风、数据库主题背景（`public/bg-login.png`，AI 生成）。
   - 演示账号：管理员 `admin / admin123`，普通用户 `zhangsan / 123456`
2. **资产设备管理**
   - 列表字段：资产设备名称、IP、环境类型、数据库（类型/版本/端口，可多套，每套带 Docker 标记）、所属公司、负责人、使用状态、操作
   - 一个资产支持**多套数据库**，每套含 数据库类型 / 版本 / 端口 / 是否Docker / 该库账号；服务器账号独立一组
   - 数据库类型切换自动带出**默认端口**（Oracle 1521 / MySQL 3306 / PostgreSQL 5432 / SqlServer 1433 / KingBase 54321 / Mongodb 27017），可自定义
   - 点击设备行 → 详情抽屉：基本信息、数据库配置（多套，位于服务器账号上方，可增/改/删）、服务器账号
   - 密码默认密文（••••••••）；普通用户点眼睛 → 输入**管理员账号+密码**验证后才显示明文（服务端 AES 解密 + 审计留痕）；3 秒自动恢复密文
   - 使用状态：新增资产默认「在线」，详情抽屉内管理员可切换 在线/离线/维护中/已下线
   - 普通用户：仅可见被授权资产与相关需求单，不显示「查看详情」、不显示操作类按钮、无配置管理菜单
3. **数据库权限变更记录**
   - 需求单：申请人、目标资产（下拉，普通用户仅限授权资产）、申请要求、状态、操作（查看 / 执行 / 删除）
   - 完成 → 仅「查看、删除」；未完成 → 「执行、查看、删除」；执行结果收进「查看」弹窗
   - 新增需求：申请人 + 目标资产 + 申请要求 → 提交后自动置顶高亮，状态=待处理
   - 打开执行窗口 → 状态置「处理中」（其他人员实时可见）；窗口内「完成」→ 追加执行结果、状态=完成；「中止」→ 状态=中止
4. **配置管理**（仅管理员可编辑，服务端存储）
   - 环境类型：正式、测试、开发（可增删）
   - 数据库类型：Oracle、MySQL、PostgreSQL、SqlServer、KingBase、Mongodb（可增删，彩色标签）
   - 执行情况状态：待处理、处理中、中止、完成
   - 端口配置：可增删，资产新增/编辑时可选
   - 数据库版本：在**新增资产时手动填写**（不再在配置页维护版本清单）
5. **系统管理 → 账号管理**（仅管理员）
   - 账号增删、角色、授权资产勾选、重置密码
   - 操作审计日志（服务端只增不删）：登录/登出、查看明文、执行权限变更、需求与账号增删、授权调整、配置保存
   - 安全设计：用户密码 bcrypt 哈希；数据库/服务器账号密码 AES-256-GCM 字段级加密；JWT 鉴权；登录失败 5 次锁定 15 分钟

## 技术栈

- 前端：React 18 + Vite 5 + Ant Design 5
- 后端：Express + `node:sqlite`（Node 22 内置，无原生编译依赖）+ `bcryptjs` + `jsonwebtoken`
- 安全：JWT 会话、bcrypt 哈希、AES-256-GCM 字段加密、服务端审计、登录限流、角色 + 授权资产双重过滤
- 桌面：Electron 35 + electron-builder（Windows NSIS/Portable，Linux 绿色版）

## 目录结构

```
├─ src/                 前端（pages/ 五个页面 + store.js API 缓存层 + constants.js 共享常量）
├─ server/             后端（db.js 数据层、auth.js 鉴权/限流、routes.js 接口、seed.js 种子、app.js 可嵌入应用工厂、index.js 独立运行入口）
├─ electron/           Electron 壳（main.js）
├─ public/bg-login.png 登录背景
├─ build/icon.png      应用图标
└─ data/               运行时数据（git 忽略：db.sqlite + .enc-key + .jwt-secret，首次启动自动创建并写种子）
```

## 本地开发

```bash
npm install
npm run server          # 后端 3001（首次启动自动建表 + 种子数据）
npm run dev            # 前端 5173，/api 自动代理到 3001
# 浏览器打开 http://localhost:5173
```

## 生产构建 / 桌面打包

```bash
npm run build                        # 前端构建到 dist/
npm run electron:build:win          # Windows：Setup 安装包 + 便携版
npm run electron:build:linux        # Linux：绿色版（本机无 fpm，AppImage/deb/rpm 跨平台受限）
npm run electron:build:all          # 双平台
# 产物输出到 release/
```

- 打包时自动：前端 `dist` + 后端 `server` + 运行依赖（express/bcryptjs/jsonwebtoken）一起打进安装包；`node:sqlite` 数据落在 `%APPDATA%`（Windows）/ `~/.config`（Linux）的用户数据目录，首次运行自动建库并写演示数据。

## 安全说明

- 用户密码 bcrypt 哈希存储，登录比对哈希而非明文
- 数据库/服务器账号密码 AES-256-GCM 加密，列表接口只返回密文占位；明文仅经服务端校验（管理员身份或提交管理员账号密码）后解密，3 秒自动隐藏并审计
- JWT 8 小时有效 + 接口级 adminOnly / 授权资产过滤；普通用户越权操作返回 403
- 操作审计服务端 `audit_log` 只增不删，前端只读（仅管理员可见）
- 登录失败 5 次锁定 15 分钟防暴力破解

## 生产化建议（代码外）

HTTPS 传输、密钥托管（Vault/KMS）、审计库定期归档为不可篡改存储（WORM）、敏感操作 MFA、按 IP 的会话管理。
