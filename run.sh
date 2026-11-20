#!/bin/sh
# 数据库资产设备管理 - Linux 绿色版启动脚本
# 用法：
#   1) 解压 db-asset-management-linux-x64.tar.gz
#   2) sh run.sh
# 若提示 sandbox 相关错误，可执行：sh run.sh --no-sandbox
# 依赖：glibc / gtk3 / libnss3 / libxss 等（大多数桌面 Linux 发行版自带）

cd "$(dirname "$0")"

# 兜底：确保可执行位（tar 包内已写入 0755，此处仅为保险）
chmod +x linux-unpacked/db-asset-management \
          linux-unpacked/chrome_crashpad_handler \
          linux-unpacked/chrome-sandbox 2>/dev/null || true

exec ./linux-unpacked/db-asset-management "$@"
