import React, { useEffect, useState } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Space,
  Popconfirm,
  Checkbox,
  App as AntApp,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  KeyOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  useAppData,
  ENV_COLOR,
  addUser,
  deleteUser,
  setUserAssets,
  resetUserPassword,
  refreshAudit,
  refreshUsers,
} from '../store';

/* 资产数据库摘要文本 */
function dbSummary(a) {
  const dbs = a.databases || [];
  if (dbs.length === 0) return '未配置数据库';
  return dbs.map((d) => `${d.dbType} ${d.dbVersion || ''} :${d.port || '-'}`).join(' / ');
}

export default function SystemsPage({ currentUser }) {
  const appData = useAppData();
  const { users, assets, audit } = appData;
  const { message } = AntApp.useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [grantUser, setGrantUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const [grantForm] = Form.useForm();
  const isAdmin = currentUser.role === '管理员';

  /* 审计日志：独立懒加载（首次进入本页才请求），不与账号表互相阻塞；操作后由 store 自动刷新 */
  const [auditFetched, setAuditFetched] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  const loadAudit = async () => {
    if (auditLoading) return;
    setAuditLoading(true);
    try {
      await refreshAudit(200);
      setAuditFetched(true);
    } catch {
      /* 审计拉取失败不影响账号部分使用 */
    } finally {
      setAuditLoading(false);
    }
  };

  const [userLoading, setUserLoading] = useState(users.length === 0);
  useEffect(() => {
    if (isAdmin && users.length === 0) {
      refreshUsers()
        .catch(() => {})
        .finally(() => setUserLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin && !auditFetched) loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, auditFetched, auditLoading]);

  if (!isAdmin) {
    return (
      <div className="page-card">
        <div className="page-title">系统管理</div>
        <Tag color="orange">无权限：账号管理仅管理员可见</Tag>
      </div>
    );
  }

  const columns = [
    { title: '账号', dataIndex: 'username', width: 160, render: (v) => <b>{v}</b> },
    {
      title: '角色',
      dataIndex: 'role',
      width: 110,
      render: (v) => <Tag color={v === '管理员' ? 'red' : 'blue'}>{v}</Tag>,
    },
    {
      title: '授权资产',
      dataIndex: 'assets',
      render: (list) =>
        list.length === 0 ? (
          <Tag color="green">全部资产</Tag>
        ) : (
          <Space size={4} wrap>
            {list.map((id) => {
              const a = assets.find((x) => x.id === id);
              return (
                <Tag key={id} color={ENV_COLOR[a?.envType] || 'default'}>
                  {a?.name || id}
                </Tag>
              );
            })}
          </Space>
        ),
    },
    {
      title: '操作',
      width: 300,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<KeyOutlined />} onClick={() => setGrantUser(r)}>
            授权资产
          </Button>
          <Popconfirm
            title={`重置 ${r.username} 的密码？`}
            onConfirm={async () => {
              const p = window.prompt(`输入 ${r.username} 的新密码（≥6位）：`);
              if (!p || p.length < 6) {
                message.warning('密码不能少于 6 位');
                return;
              }
              setBusy(true);
              try {
                await resetUserPassword(r.username, p);
                message.success('密码已重置（服务端 bcrypt 哈希 + 审计留痕）');
              } catch (e) {
                message.error(e.message || '重置失败');
              } finally {
                setBusy(false);
              }
            }}
            okText="重置"
            cancelText="取消"
          >
            <Button size="small" icon={<LockOutlined />} loading={busy}>
              重置密码
            </Button>
          </Popconfirm>
          {r.username !== 'admin' && (
            <Popconfirm
              title={`删除账号 ${r.username}？`}
              onConfirm={async () => {
                try {
                  await deleteUser(r.username);
                  message.success('账号已删除');
                } catch (e) {
                  message.error(e.message || '删除失败');
                }
              }}
              okText="删除"
              cancelText="取消"
            >
              <Button size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const grantOpen = !!grantUser;

  const saveGrant = async () => {
    const v = await grantForm.validateFields();
    setBusy(true);
    try {
      await setUserAssets(grantUser.username, v.assetIds || []);
      message.success(`已保存「${grantUser.username}」的授权资产`);
      setGrantUser(null);
    } catch (e) {
      message.error(e.message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const submitAdd = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      await addUser({
        username: v.username.trim(),
        password: v.password,
        role: v.role,
        assetIds: v.role === '管理员' ? [] : v.assetIds || [],
      });
      form.resetFields();
      setAddOpen(false);
      message.success('账号创建成功（密码 bcrypt 哈希存储）');
    } catch (e) {
      message.error(e.message || '创建失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-card">
      <div className="page-title">
        <span>系统管理 · 账号管理</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          新增账号
        </Button>
      </div>

      <div style={{ marginBottom: 12, fontSize: 13, color: '#5a6a85' }}>
        <Tag color="red">管理员</Tag> 拥有全部权限（全部资产 + 操作权限）；
        <Tag color="blue">普通用户</Tag> 仅可见被授权的资产与相关需求单，且不显示执行 / 删除等操作信息（服务端按角色 + 授权资产双重过滤）。
      </div>

      <Table
        rowKey="username"
        size="middle"
        columns={columns}
        dataSource={users}
        pagination={false}
        loading={userLoading || busy}
        locale={{ emptyText: '暂无账号' }}
      />

      {/* 操作审计日志（服务端存储，只增不删） */}
      <div className="config-block" style={{ marginTop: 24 }}>
        <h4>
          <Space>
            <SafetyCertificateOutlined /> 操作审计日志（服务端）
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={loadAudit}
              loading={auditLoading}
            >
              重新加载
            </Button>
          </Space>
          <div style={{ fontSize: 12, color: '#8a97ab', fontWeight: 400, marginTop: 4 }}>
            记录登录 / 查看明文密码 / 执行权限变更 / 账号与授权变更 / 配置保存等敏感操作，仅管理员可查，服务端只增不删
          </div>
        </h4>
        <Table
          rowKey={(r) => `${r.id}-${r.time}`}
          size="small"
          columns={[
            { title: '时间', dataIndex: 'time', width: 170 },
            { title: '操作人', dataIndex: 'user', width: 110, render: (v) => <b>{v || '-'}</b> },
            { title: '操作', dataIndex: 'action', width: 190, render: (v) => <Tag>{v}</Tag> },
            { title: '详情', dataIndex: 'detail', render: (v) => v || '-' },
          ]}
          dataSource={audit || []}
          loading={auditLoading}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
          locale={{ emptyText: auditFetched ? '暂无审计记录' : '正在加载审计日志…' }}
        />
      </div>

      {/* 安全设计说明 */}
      <div className="config-block" style={{ marginTop: 16, fontSize: 13, color: '#5a6a85' }}>
        <b>安全设计说明（服务端已实现）：</b>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.9 }}>
          <li>用户密码：服务端 <b>bcrypt 哈希</b>存储，登录比对哈希而非明文；数据库 / 服务器账号密码：<b>AES-256-GCM 字段级加密</b>存储，列表接口只返回密文占位。</li>
          <li>鉴权：JWT（8 小时有效）+ 接口级 <b>adminOnly / 资产授权过滤</b>，普通用户越权操作返回 403；登录失败 5 次锁定 15 分钟（防暴力破解）。</li>
          <li>权限隔离：资产、需求单、目标资产下拉均按「角色 + 授权资产」服务端过滤；普通用户隐藏执行 / 删除 / 新增 / 编辑等操作按钮。</li>
          <li>明文查看：仅经服务端校验（管理员身份，或提交管理员账号密码）后解密返回，3 秒自动隐藏，并写入审计日志。</li>
          <li>操作审计：<b>服务端 audit_log 只增不删</b>，覆盖登录 / 登出 / 查看明文 / 执行 / 需求与账号增删 / 授权调整 / 配置保存等敏感操作，前端只读。</li>
          <li>待生产化：接入 HTTPS、密钥托管（Vault/KMS）、审计库不可篡改（WORM）、敏感操作 MFA、按 IP 的会话管理。</li>
        </ul>
      </div>

      {/* 新增账号 */}
      <Modal
        title="新增账号"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={submitAdd}
        okText="创建"
        okButtonProps={{ loading: busy }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ role: '普通用户' }}>
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input placeholder="登录账号" allowClear />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码不少于6位' },
            ]}
          >
            <Input.Password placeholder="初始登录密码（服务端 bcrypt 哈希存储）" />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select
              options={[
                { value: '管理员', label: '管理员（全部权限）' },
                { value: '普通用户', label: '普通用户（仅授权资产）' },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.role !== b.role}>
            {({ getFieldValue }) =>
              getFieldValue('role') === '普通用户' ? (
                <Form.Item
                  name="assetIds"
                  label="授权资产（可勾选多台；不勾选则不可见任何资产）"
                >
                  <Checkbox.Group
                    options={assets.map((a) => ({
                      label: `${a.name}（${dbSummary(a)} / ${a.ip}）`,
                      value: a.id,
                    }))}
                    style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                  />
                </Form.Item>
              ) : (
                <Form.Item>
                  <Tag color="green">管理员自动获得全部资产权限，无需勾选</Tag>
                </Form.Item>
              )
            }
          </Form.Item>
        </Form>
      </Modal>

      {/* 授权资产管理 */}
      <Modal
        title={`授权资产 - ${grantUser?.username || ''}`}
        open={grantOpen}
        onCancel={() => setGrantUser(null)}
        onOk={saveGrant}
        okText="保存授权"
        okButtonProps={{ loading: busy }}
        destroyOnClose
        afterOpenChange={(open) => {
          if (open && grantUser) {
            grantForm.setFieldsValue({
              assetIds: grantUser.role === '管理员' ? [] : grantUser.assets,
            });
          }
        }}
      >
        <Form form={grantForm} layout="vertical">
          <Form.Item noStyle>
            {grantUser?.role === '管理员' ? (
              <Tag color="green">管理员角色：始终拥有全部资产权限</Tag>
            ) : (
              <Form.Item name="assetIds">
                <Checkbox.Group
                  options={assets.map((a) => ({
                    label: `${a.name}（${dbSummary(a)} / ${a.ip}）`,
                    value: a.id,
                  }))}
                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                />
              </Form.Item>
            )}
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
