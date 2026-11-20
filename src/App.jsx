import React, { useEffect, useState } from 'react';
import { Layout, Menu, Button, Typography, Tag, Space, Spin } from 'antd';
import NoAccess from './NoAccess.jsx';
import {
  DatabaseOutlined,
  AuditOutlined,
  SettingOutlined,
  LogoutOutlined,
  CloudServerOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import {
  useAppData,
  getToken,
  clearToken,
  logout,
  refreshBootstrap,
  refreshUsers,
  onUnauthorized,
} from './store';
import Login from './pages/Login.jsx';
import AssetsPage from './pages/AssetsPage.jsx';
import ChangesPage from './pages/ChangesPage.jsx';
import ConfigPage from './pages/ConfigPage.jsx';
import SystemsPage from './pages/SystemsPage.jsx';

const MENU = [
  { key: 'assets', icon: <DatabaseOutlined />, label: '资产设备管理' },
  { key: 'changes', icon: <AuditOutlined />, label: '权限变更记录' },
  { key: 'config', icon: <SettingOutlined />, label: '配置管理' },
  { key: 'systems', icon: <TeamOutlined />, label: '系统管理' },
];

export default function App() {
  const appData = useAppData();
  const [active, setActive] = useState('assets');
  const [booting, setBooting] = useState(!!getToken());

  // 登录成功后 store.user 被写入；未登录则显示登录页
  const user = appData.user;

  // 401（token 过期/失效）→ 清 token，回到登录页
  useEffect(
    () =>
      onUnauthorized(() => {
        clearToken();
      }),
    []
  );

  // 启动时若已有 token，恢复会话数据
  useEffect(() => {
    if (getToken()) {
      refreshBootstrap()
        .then((user) => {
          // 管理员拉取账号与审计
          if (user?.role === '管理员') refreshUsers().catch(() => {});
        })
        .catch(() => clearToken())
        .finally(() => setBooting(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doLogout = () => {
    logout();
  };

  if (!user) {
    if (booting) {
      return (
        <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" tip="正在连接服务端…" />
        </div>
      );
    }
    return <Login />;
  }

  return (
    <Layout style={{ minHeight: '100vh' }} className="app-layout">
      <Layout.Sider width={232} trigger={null} className="sider">
        <div className="logo">
          <CloudServerOutlined style={{ fontSize: 26, color: '#4da3ff' }} />
          <div>
            <div className="logo-title">数据库资产设备管理</div>
            <div className="logo-sub">DB Asset Management</div>
          </div>
        </div>
        <Menu
          mode="inline"
          theme="dark"
          selectedKeys={[active]}
          items={MENU.filter((m) =>
            user.role === '管理员' ? true : m.key !== 'systems' && m.key !== 'config'
          )}
          onClick={({ key }) => setActive(key)}
          style={{ borderInlineEnd: 'none', flex: 1 }}
        />
        <div className="sider-footer">
          <Button
            icon={<LogoutOutlined />}
            onClick={doLogout}
            block
            type="text"
            style={{ color: '#cfd8e3' }}
          >
            退出登录
          </Button>
        </div>
      </Layout.Sider>
      <Layout>
        <Layout.Header className="app-header">
          <Typography.Text strong style={{ color: '#fff', fontSize: 16 }}>
            {MENU.find((m) => m.key === active)?.label}
          </Typography.Text>
          <Space>
            <Tag color="success">在线</Tag>
            <Typography.Text strong style={{ color: '#fff' }}>
              {user.username}（{user.role}）
            </Typography.Text>
          </Space>
        </Layout.Header>
        <Layout.Content className="app-content">
          {active === 'assets' && <AssetsPage currentUser={user} />}
          {active === 'changes' && <ChangesPage currentUser={user} />}
          {active === 'config' &&
            (user.role === '管理员' ? (
              <ConfigPage currentUser={user} />
            ) : (
              <NoAccess label="配置管理" />
            ))}
          {active === 'systems' &&
            (user.role === '管理员' ? (
              <SystemsPage currentUser={user} />
            ) : (
              <NoAccess label="系统管理" />
            ))}
        </Layout.Content>
        <Layout.Footer className="app-footer">
          数据库资产设备管理 · 服务端鉴权 + 字段级加密 + 操作审计
        </Layout.Footer>
      </Layout>
    </Layout>
  );
}
