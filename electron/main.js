import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 定位物理文件根目录：
//  - 打包后：resources/app.asar.unpacked（server/ dist/ node_modules/ 均解包于此）
//  - dev：项目根目录（electron/ 的上一级）
const rootDir = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked')
  : path.join(__dirname, '..');

// 数据目录：打包后数据库/密钥落在用户数据目录（%APPDATA% / ~/.config），不写入安装目录
const DATA_DIR = path.join(app.getPath('userData'), 'data');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let win = null;
  let server = null;

  const start = async () => {
    process.env.DB_DATA_DIR = DATA_DIR;
    // 动态导入解包后的服务端（保证 env 在 db.js/auth.js 求值前设置，且走物理文件解析）
    const appUrl = pathToFileURL(path.join(rootDir, 'server', 'app.js')).href;
    const { startServer } = await import(appUrl);
    server = await startServer(0); // 随机端口，仅回环
    const port = server.address().port;

    win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 1024,
      minHeight: 700,
      title: '数据库资产设备管理',
      backgroundColor: '#0f1728',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http')) shell.openExternal(url);
      return { action: 'deny' };
    });

    await win.loadURL(`http://127.0.0.1:${port}/`);
    win.on('closed', () => {
      win = null;
    });
  };

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(start);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    if (server) server.close();
  });
}
