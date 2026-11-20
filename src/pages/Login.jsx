import React, { useState } from 'react';
import { Form, Input, Button, Alert, Spin } from 'antd';
import { LockOutlined, UserOutlined, DatabaseOutlined } from '@ant-design/icons';
import { login } from '../store';

export default function Login() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = async (values) => {
    setError('');
    setBusy(true);
    try {
      await login(values.username.trim(), values.password);
      // 登录成功：store 已写入 user + bootstrap，App 会因数据变化自动切换到主界面
    } catch (e) {
      setError(e.message || '登录失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <div className="icon-ring">
            <DatabaseOutlined />
          </div>
          <h1>数据库资产设备管理</h1>
          <p>DB ASSET &amp; DEVICE MANAGEMENT</p>
        </div>

        {error && (
          <Alert
            type="error"
            showIcon
            message={error}
            style={{ marginBottom: 14 }}
            onClose={() => setError('')}
          />
        )}

        <Form layout="vertical" onFinish={finish} size="large">
          <Form.Item
            label="账号"
            name="username"
            rules={[{ required: true, message: '请输入账号' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="请输入登录账号" allowClear />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="请输入登录密码" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, marginTop: 18 }}>
            <Button type="primary" htmlType="submit" block loading={busy}>
              登 录
            </Button>
          </Form.Item>
        </Form>

        <div className="login-hint">
          演示账号：管理员 <code>admin / admin123</code>，普通用户 <code>zhangsan / 123456</code>
          <br />
          提示：查看资产明细密码需通过服务端校验（管理员账号），并全程留痕审计。
        </div>
      </div>
      <div className="login-footer">© 2026 数据库资产设备管理 · 企业级数据资产管理平台（服务端鉴权 + 字段级加密 + 操作审计）</div>
    </div>
  );
}
