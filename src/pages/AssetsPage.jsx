import React, { useEffect, useRef, useState } from 'react';
import {
  Table,
  Button,
  Drawer,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Space,
  Popconfirm,
  Divider,
  Tooltip,
  App as AntApp,
  Empty,
  Progress,
} from 'antd';
import {
  PlusOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  DeleteOutlined,
  KeyOutlined,
  UserOutlined,
  DatabaseOutlined,
  EditOutlined,
  UploadOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import {
  useAppData,
  ENV_COLOR,
  DB_TYPE_COLORS,
  DB_TYPE_COLOR_FALLBACK,
  DEFAULT_PORT,
  revealPassword,
  addAccount,
  deleteAccount,
  addDatabase,
  updateDatabase,
  removeDatabase,
  addAsset,
  deleteAsset,
  updateAssetStatus,
} from '../store';
import { exportAssetsToExcel, parseExcelImport } from '../utils/excel.js';

/* 高对比度数据库类型标签（深色底 + 白字） */
export function DbTypeTag({ type }) {
  const c = DB_TYPE_COLORS[type] || DB_TYPE_COLOR_FALLBACK;
  return <Tag style={{ background: c.bg, color: c.color, borderColor: c.bg, fontWeight: 600 }}>{type}</Tag>;
}

/* ---------- 密码查看：列表默认密文；明文仅经服务端校验后短时展示 ---------- */
function PasswordCell({ accountId, isAdmin }) {
  const [revealed, setRevealed] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const { message } = AntApp.useApp();

  const doReveal = async (adminUsername, adminPassword) => {
    try {
      const plain = await revealPassword(accountId, adminUsername, adminPassword);
      setRevealed(plain);
      setModalOpen(false);
      form.resetFields();
    } catch (e) {
      if (e.status !== 401) message.error(e.message || '获取明文失败');
      setModalOpen(false);
      form.resetFields();
    }
  };

  // 明文展示 3 秒后自动恢复密文
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(''), 3000);
    return () => clearTimeout(t);
  }, [revealed]);

  const show = revealed !== '';

  return (
    <Space size={6}>
      <span className="pwd-text">{show ? revealed : '••••••••'}</span>
      {isAdmin ? (
        <Button
          type="text"
          size="small"
          icon={show ? <EyeInvisibleOutlined /> : <EyeOutlined />}
          onClick={() => {
            if (show) setRevealed('');
            else doReveal(null, null);
          }}
        />
      ) : (
        <Button
          type="text"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => setModalOpen(true)}
          title="输入管理员账号查看"
        />
      )}
      <Modal
        title={
          <Space>
            <KeyOutlined /> 查看明文密码（服务端校验 + 审计留痕）
          </Space>
        }
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText="确认显示"
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => doReveal(v.adminUser.trim(), v.adminPass)}
        >
          <Form.Item
            label="管理员账号"
            name="adminUser"
            rules={[{ required: true, message: '请输入管理员账号' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="请输入管理员账号" allowClear />
          </Form.Item>
          <Form.Item
            label="管理员密码"
            name="adminPass"
            rules={[{ required: true, message: '请输入管理员密码' }]}
          >
            <Input.Password prefix={<KeyOutlined />} placeholder="请输入管理员密码" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

/* ---------- 账号表格（服务器 / 数据库通用） ---------- */
function AccountTable({ accounts, isAdmin, onAdd, onDelete, typeLabel }) {
  const columns = [
    {
      title: '账号',
      dataIndex: 'account',
      width: 170,
      render: (v) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '密码（密文，点眼睛查明文）',
      dataIndex: 'id',
      render: (id) => <PasswordCell accountId={id} isAdmin={isAdmin} />,
    },
    {
      title: '操作',
      width: 70,
      render: (_, r) =>
        isAdmin ? (
          <Popconfirm title={`删除${typeLabel}账号 ${r.account}？`} onConfirm={() => onDelete(r.id)}>
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        ) : (
          <span style={{ color: '#b6c0d0' }}>—</span>
        ),
    },
  ];
  return (
    <div>
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={accounts}
        pagination={false}
        locale={{
          emptyText: (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`暂无${typeLabel}账号`} />
          ),
        }}
      />
      {isAdmin && (
        <div style={{ marginTop: 8 }}>
          <Button type="dashed" block size="small" icon={<PlusOutlined />} onClick={() => onAdd()}>
            新增{typeLabel}账号密码
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------- 数据库信息编辑弹窗（类型/版本/端口，类型变化自动带出默认端口） ---------- */
function EditDbModal({ open, assetId, dbId, onCancel }) {
  const appData = useAppData();
  const { config } = appData;
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const asset = appData.assets.find((a) => a.id === assetId);
  const db = (asset?.databases || []).find((x) => x.id === dbId);

  useEffect(() => {
    if (open && db) {
      form.setFieldsValue({
        dbType: db.dbType,
        dbVersion: db.dbVersion,
        port: db.port,
        dbIsDocker: !!db.dbIsDocker,
      });
    }
  }, [open, dbId]);

  const save = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      await updateDatabase(dbId, {
        dbType: v.dbType,
        dbVersion: v.dbVersion || '',
        port: String(v.port || '').trim(),
        dbIsDocker: !!v.dbIsDocker,
      });
      message.success('数据库配置已更新');
      onCancel();
    } catch (e) {
      message.error(e.message || '更新失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="编辑数据库配置" open={open} onCancel={onCancel} onOk={save} okButtonProps={{ loading: busy }} destroyOnClose width={460}>
      <Form form={form} layout="vertical">
        <Form.Item
          name="dbType"
          label="数据库类型"
          rules={[{ required: true, message: '请选择数据库类型' }]}
        >
          <Select
            options={config.dbTypes.map((t) => ({ value: t, label: t }))}
            onChange={(val) => {
              if (DEFAULT_PORT[val]) form.setFieldValue('port', DEFAULT_PORT[val]);
              form.setFieldValue('dbVersion', undefined);
            }}
          />
        </Form.Item>
        <Form.Item
          name="dbVersion"
          label="数据库版本（手动填写）"
          rules={[{ required: true, message: '请输入数据库版本' }]}
        >
          <Input placeholder="如：19c / 8.0 / 14.3" allowClear />
        </Form.Item>
        <Form.Item name="port" label="数据库端口（随类型自动带出默认值，可自定义）" rules={[{ required: true, message: '请输入端口' }]}>
          <Input placeholder="如：1521" allowClear />
        </Form.Item>
        <Form.Item name="dbIsDocker" label="是否Docker（该数据库是否以容器方式部署）" initialValue={false}>
          <Select
            options={[
              { value: false, label: '否' },
              { value: true, label: '是' },
            ]}
            style={{ width: 120 }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/* ---------- 新增账号弹窗 ---------- */
function AddAccountModal({ open, type, asset, dbLabel, onCancel, onOk }) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const label = type === 'server' ? '服务器' : dbLabel;
  return (
    <Modal
      title={`新增${label}账号密码 - ${asset?.name || ''}`}
      open={open}
      onCancel={onCancel}
      onOk={async () => {
        const v = await form.validateFields();
        setBusy(true);
        try {
          await onOk(v);
          form.resetFields();
        } finally {
          setBusy(false);
        }
      }}
      okButtonProps={{ loading: busy }}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item label="账号类型">
          <Tag color={type === 'server' ? 'blue' : 'geekcyan'}>{label}</Tag>
        </Form.Item>
        <Form.Item name="account" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
          <Input placeholder={`请输入${label}账号`} allowClear />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码（服务端 AES 加密存储，列表默认密文）"
          rules={[
            { required: true, message: '请输入密码' },
            { min: 6, message: '密码不少于6位' },
          ]}
        >
          <Input.Password placeholder="请输入密码" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/* ---------- 资产详情抽屉 ---------- */
function AssetDetailDrawer({ asset, currentUser, onClose }) {
  const appData = useAppData();
  const { config } = appData;
  const { message } = AntApp.useApp();
  const [accOpen, setAccOpen] = useState(false);
  const [accTarget, setAccTarget] = useState(null); // { kind:'server' | 'db', dbId? }
  const [editDbId, setEditDbId] = useState(null);
  const isAdmin = currentUser.role === '管理员';
  const asset_ = appData.assets.find((a) => a.id === asset);
  if (!asset_) return null;

  const openAcc = (kind, dbId) => {
    setAccTarget({ kind, dbId });
    setAccOpen(true);
  };

  const addAccount = async (v) => {
    await addAccount({
      assetId: asset_.id,
      kind: accTarget.kind === 'db' ? 'db' : 'server',
      refId: accTarget.dbId || null,
      account: v.account,
      password: v.password,
    });
    setAccOpen(false);
    message.success('账号已新增（密码已加密存储）');
  };

  const deleteServerAccount = async (accId) => {
    await deleteAccount(accId);
    message.success('账号已删除');
  };

  const deleteDbAccount = (dbId, accId) => () => {
    deleteAccount(accId).then(() => message.success('账号已删除'));
  };

  const addDatabase = async () => {
    const t = config.dbTypes[0];
    await addDatabase(asset_.id, { dbType: t, port: DEFAULT_PORT[t] || '' });
    message.success('已新增一套数据库配置，可点击「编辑」完善');
  };

  const removeDatabase = async (dbId) => {
    await removeDatabase(dbId);
    message.success('数据库配置已删除（连同其账号）');
  };

  const kv = (label, value) => (
    <div className="kv-item" key={label}>
      <span style={{ color: '#8a97ab', fontSize: 13 }}>{label}</span>
      <b style={{ color: '#1f2d45', fontWeight: 500, marginLeft: 10, fontSize: 13 }}>
        {value === '' || value === null || value === undefined ? '-' : value}
      </b>
    </div>
  );

  const dbLabelForTarget =
    accTarget?.kind === 'db'
      ? asset_.databases.find((d) => d.id === accTarget.dbId)?.dbType || '数据库'
      : '服务器';

  return (
    <Drawer
      title={
        <Space>
          资产设备详情
          <Tag color="blue">{asset_.name}</Tag>
        </Space>
      }
      width={600}
      open
      onClose={onClose}
      destroyOnClose
    >
      {/* 基本信息 */}
      <div className="detail-section">
        <div className="detail-section-title">
          <Space>
            <UserOutlined /> 基本信息
          </Space>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px 24px' }}>
          {kv('设备名称', asset_.name)}
          {kv('IP 地址', asset_.ip)}
          {kv('环境类型', <Tag color={ENV_COLOR[asset_.envType] || 'default'}>{asset_.envType}</Tag>)}
          {kv('所属公司', asset_.company)}
          {kv('负责人', asset_.owner)}
          {/* 使用状态：管理员可切换，新增资产默认为「在线」 */}
          <div className="kv-item" key="status" style={{ gridColumn: '1 / -1' }}>
            <span style={{ color: '#8a97ab', fontSize: 13 }}>使用状态</span>
            {isAdmin ? (
              <Select
                size="small"
                style={{ width: 120, marginLeft: 10 }}
                value={asset_.status || '在线'}
                options={['在线', '离线', '维护中', '已下线'].map((s) => ({ value: s, label: s }))}
                onChange={async (s) => {
                  try {
                    await updateAssetStatus(asset_.id, s);
                    message.success(`「${asset_.name}」使用状态已更新为 ${s}`);
                  } catch (e) {
                    message.error(e.message || '状态更新失败');
                  }
                }}
              />
            ) : (
              <Tag
                color={(asset_.status || '在线') === '在线' ? 'success' : (asset_.status === '离线' ? 'default' : 'orange')}
                style={{ marginLeft: 10 }}
              >
                {asset_.status || '在线'}
              </Tag>
            )}
          </div>
        </div>
      </div>

      {/* 数据库配置（多套，位于服务器账号上方） */}
      <div className="detail-section">
        <div className="detail-section-title">
          <Space>
            <DatabaseOutlined /> 数据库配置
            <Tag>{asset_.databases.length} 套</Tag>
          </Space>
          {isAdmin && (
            <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={addDatabase}>
              新增数据库
            </Button>
          )}
        </div>
        {asset_.databases.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据库配置" />}
        {asset_.databases.map((db, idx) => (
          <div
            key={db.id}
            style={{
              border: '1px solid #e6ebf3',
              borderRadius: 8,
              padding: '12px 14px',
              marginBottom: 12,
              background: '#fff',
            }}
          >
            <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 10 }} wrap>
              <Space wrap>
                <span style={{ color: '#8a97ab', fontSize: 12 }}>#{idx + 1}</span>
                <DbTypeTag type={db.dbType} />
                <Tag>{db.dbVersion || '未定版本'}</Tag>
                <Tooltip title="数据库端口">
                  <Tag color="cyan">端口 {db.port || '-'}</Tag>
                </Tooltip>
                {db.dbIsDocker ? <Tag color="geekblue">Docker 容器</Tag> : <Tag>非容器</Tag>}
              </Space>
              {isAdmin && (
                <Space>
                  <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditDbId(db.id)}>
                    编辑
                  </Button>
                  <Popconfirm
                    title={`删除该数据库配置（${db.dbType}）及其账号？`}
                    onConfirm={() => removeDatabase(db.id)}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              )}
            </Space>
            <div style={{ fontSize: 12, color: '#5a6a85', marginBottom: 6 }}>
              数据库账号（{db.dbAccounts.length}）
            </div>
            <AccountTable
              accounts={db.dbAccounts}
              isAdmin={isAdmin}
              typeLabel={`${db.dbType} 数据库`}
              onAdd={() => openAcc('db', db.id)}
              onDelete={deleteDbAccount(db.id)}
            />
          </div>
        ))}
      </div>

      {/* 服务器账号 */}
      <div className="detail-section">
        <div className="detail-section-title">
          <Space>
            <UserOutlined /> 服务器账号
            <Tag>{asset_.serverAccounts.length}</Tag>
          </Space>
          {isAdmin && (
            <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={() => openAcc('server')}>
              新增
            </Button>
          )}
        </div>
        <AccountTable
          accounts={asset_.serverAccounts}
          isAdmin={isAdmin}
          typeLabel="服务器"
          onAdd={() => openAcc('server')}
          onDelete={deleteServerAccount}
        />
      </div>

      <AddAccountModal
        open={accOpen}
        type={accTarget?.kind || 'server'}
        dbLabel={dbLabelForTarget}
        asset={asset_}
        onCancel={() => setAccOpen(false)}
        onOk={addAccount}
      />
      {editDbId && (
        <EditDbModal
          open={!!editDbId}
          assetId={asset_.id}
          dbId={editDbId}
          onCancel={() => setEditDbId(null)}
        />
      )}
    </Drawer>
  );
}

/* ---------- 新增资产设备弹窗 ---------- */
function AddAssetModal({ open, onCancel, onOk }) {
  const { config } = useAppData();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      const stripAccounts = (rows) =>
        (rows || []).filter((r) => r && (r.account || r.password));
      await onOk({
        name: v.name.trim(),
        ip: v.ip.trim(),
        envType: v.envType,
        owner: v.owner ? v.owner.trim() : '',
        company: v.company ? v.company.trim() : '',
        databases: (v.databases || [])
          .filter((d) => d && d.dbType)
          .map((d) => ({
            dbType: d.dbType,
            dbVersion: d.dbVersion || '',
            port: String(d.port || '').trim(),
            dbIsDocker: !!d.dbIsDocker,
            dbAccounts: stripAccounts(d.dbAccounts),
          })),
        serverAccounts: stripAccounts(v.serverAccounts),
      });
      form.resetFields();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="新增资产设备"
      open={open}
      onCancel={onCancel}
      onOk={submit}
      okText="保存"
      okButtonProps={{ loading: busy }}
      cancelText="取消"
      width={780}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0 16px' }}>
          <Form.Item name="name" label="资产设备名称" rules={[{ required: true, message: '请输入资产设备名称' }]}>
            <Input placeholder="如：核心业务库-Oracle01" allowClear />
          </Form.Item>
          <Form.Item
            name="ip"
            label="IP 地址"
            rules={[
              { required: true, message: '请输入 IP 地址' },
              {
                pattern: /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
                message: 'IP 格式不正确',
              },
            ]}
          >
            <Input placeholder="如：10.20.1.11" allowClear />
          </Form.Item>
          <Form.Item name="envType" label="环境类型" rules={[{ required: true, message: '请选择环境类型' }]}>
            <Select placeholder="请选择" options={config.envTypes.map((t) => ({ value: t, label: t }))} />
          </Form.Item>
          <Form.Item name="company" label="所属公司">
            <Input placeholder="请输入所属公司" allowClear />
          </Form.Item>
          <Form.Item name="owner" label="负责人">
            <Input placeholder="请输入负责人" allowClear />
          </Form.Item>
        </div>

        {/* 数据库配置（多套，位于服务器账号上方） */}
        <Divider orientation="left" style={{ marginTop: 0 }}>
          <Space>
            <DatabaseOutlined /> 数据库配置（类型 / 版本 / 端口，可多套）
          </Space>
        </Divider>
        <Form.List name="databases" initialValue={[{}]}>
          {(dbFields, { add, remove }) => (
            <Space direction="vertical" style={{ width: '100%' }} size={10}>
              {dbFields.map((f, fIdx) => (
                <div
                  key={f.key}
                  style={{
                    border: '1px dashed #9db6d8',
                    borderRadius: 8,
                    padding: '12px 14px 4px',
                    background: '#f8faff',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <b style={{ fontSize: 13, color: '#24365a' }}>数据库 {fIdx + 1}</b>
                    {dbFields.length > 1 && (
                      <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => remove(f.name)}>
                        移除
                      </Button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 14px' }}>
                    <Form.Item name={[f.name, 'dbType']} label="数据库类型" rules={[{ required: true, message: '请选择' }]}>
                      <Select
                        placeholder="请选择"
                        options={config.dbTypes.map((t) => ({ value: t, label: t }))}
                        onChange={(val) => {
                          if (DEFAULT_PORT[val]) form.setFieldValue(['databases', f.name, 'port'], DEFAULT_PORT[val]);
                          form.setFieldValue(['databases', f.name, 'dbVersion'], undefined);
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[f.name, 'dbVersion']}
                      label="数据库版本（手动填写）"
                      rules={[{ required: true, message: '请输入数据库版本' }]}
                    >
                      <Input placeholder="如：19c / 8.0 / 14.3" allowClear />
                    </Form.Item>
                    <Form.Item name={[f.name, 'port']} label="数据库端口（可自定义）" rules={[{ required: true, message: '请输入端口' }]}>
                      <Select
                        showSearch
                        placeholder="随类型自动带出默认值"
                        options={config.ports.map((p) => ({ value: p, label: p }))}
                      />
                    </Form.Item>
                    <Form.Item name={[f.name, 'dbIsDocker']} label="是否Docker（该库是否容器部署）" initialValue={false}>
                      <Select
                        options={[
                          { value: false, label: '否' },
                          { value: true, label: '是' },
                        ]}
                        style={{ width: 110 }}
                      />
                    </Form.Item>
                  </div>
                  <Form.Item label={`该数据库账号密码（# ${fIdx + 1}，可多组）`} style={{ marginTop: 0 }}>
                    <Form.List name={[f.name, 'dbAccounts']}>
                      {(accFields, { add: addAcc, remove: removeAcc }) => (
                        <Space direction="vertical" style={{ width: '100%' }}>
                          {accFields.map((af) => (
                            <Space key={af.key} align="start">
                              <Form.Item name={[af.name, 'account']} style={{ margin: 0 }}>
                                <Input placeholder="数据库账号" style={{ width: 200 }} />
                              </Form.Item>
                              <Form.Item name={[af.name, 'password']} style={{ margin: 0 }}>
                                <Input.Password placeholder="数据库密码" style={{ width: 200 }} />
                              </Form.Item>
                              {accFields.length > 1 && (
                                <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeAcc(af.name)} />
                              )}
                            </Space>
                          ))}
                          <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => addAcc()}>
                            新增一组账号密码
                          </Button>
                        </Space>
                      )}
                    </Form.List>
                  </Form.Item>
                </div>
              ))}
              <Button
                type="dashed"
                block
                icon={<PlusOutlined />}
                onClick={() => add({ dbType: undefined, port: undefined, dbVersion: undefined, dbIsDocker: false })}
              >
                + 新增一套数据库（类型 / 版本 / 端口）
              </Button>
            </Space>
          )}
        </Form.List>

        {/* 服务器账号（位于数据库配置下方） */}
        <Divider orientation="left">
          <Space>
            <UserOutlined /> 服务器账号密码（可多组）
          </Space>
        </Divider>
        <Form.List name="serverAccounts">
          {(fields, { add, remove }) => (
            <Space direction="vertical" style={{ width: '100%' }}>
              {fields.map((f) => (
                <Space key={f.key} align="start">
                  <Form.Item name={[f.name, 'account']} style={{ margin: 0 }}>
                    <Input placeholder="服务器账号" style={{ width: 220 }} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'password']} style={{ margin: 0 }}>
                    <Input.Password placeholder="服务器密码" style={{ width: 220 }} />
                  </Form.Item>
                  {fields.length > 1 && (
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} />
                  )}
                </Space>
              ))}
              <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add()}>
                新增一组账号密码
              </Button>
            </Space>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}

/* ---------- 主页面 ---------- */
export default function AssetsPage({ currentUser }) {
  const appData = useAppData();
  const { message } = AntApp.useApp();
  const [detailId, setDetailId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const fileRef = useRef(null);
  const isAdmin = currentUser.role === '管理员';

  // 服务端已按角色过滤，前端直接使用
  const assets = appData.assets;

  const columns = [
    { title: '资产设备名称', dataIndex: 'name', width: 190, render: (v) => <b>{v}</b> },
    { title: 'IP 地址', dataIndex: 'ip', width: 130 },
    {
      title: '环境类型',
      dataIndex: 'envType',
      width: 100,
      render: (v) => <Tag color={ENV_COLOR[v] || 'default'}>{v}</Tag>,
    },
    {
      title: '数据库（类型/版本/端口/Docker）',
      key: 'databases',
      width: 280,
      render: (_, r) => (
        <Space size={4} wrap>
          {(r.databases || []).length === 0 && <Tag>未配置</Tag>}
          {(r.databases || []).map((db, i) => (
            <Space key={db.id} size={4}>
              {i > 0 && <span style={{ color: '#c2cbd8' }}>|</span>}
              <DbTypeTag type={db.dbType} />
              <span style={{ fontSize: 12, color: '#5a6a85' }}>
                {db.dbVersion || '未定版本'} :{db.port || '-'}
              </span>
              {db.dbIsDocker ? <Tag color="geekblue" style={{ fontSize: 11 }}>Docker</Tag> : null}
            </Space>
          ))}
        </Space>
      ),
    },
    { title: '所属公司', dataIndex: 'company', width: 110, render: (v) => v || '-' },
    { title: '负责人', dataIndex: 'owner', width: 90, render: (v) => v || '-' },
    {
      title: '使用状态',
      dataIndex: 'status',
      width: 90,
      render: (v) => (
        <Tag color={v === '在线' ? 'success' : v === '离线' ? 'default' : 'orange'}>
          {v || '在线'}
        </Tag>
      ),
    },
    ...(isAdmin
      ? [
          {
            title: '操作',
            width: 150,
            render: (_, r) => (
              <Space size={4}>
                <Button
                  type="link"
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDetailId(r.id);
                  }}
                >
                  查看详情
                </Button>
                <Popconfirm
                  title={`删除资产设备「${r.name}」？`}
                  description="将级联删除其数据库配置与账号（不可恢复）"
                  onConfirm={async () => {
                    try {
                      await deleteAsset(r.id);
                      message.success(`资产设备「${r.name}」已删除`);
                    } catch (e) {
                      message.error(e.message || '删除失败');
                    }
                  }}
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                >
                  <Button
                    type="link"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={(e) => e.stopPropagation()}
                  >
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ];

  const dbText = (a) =>
    (a.databases || [])
      .map((d) => `${d.dbType} ${d.dbVersion || ''} ${d.port || ''}`)
      .join(' ');

  const filtered = assets.filter(
    (a) =>
      !filter ||
      [a.name, a.ip, a.owner, a.envType, a.company, dbText(a)]
        .join(' ')
        .toLowerCase()
        .includes(filter.toLowerCase())
  );

  const handleAddAsset = async (payload) => {
    await addAsset(payload);
    setAddOpen(false);
    message.success(`资产设备「${payload.name}」添加成功`);
  };

  /* 导出 Excel（仅管理员：导出含明文账号密码，逐条服务端解密 + 审计） */
  const handleExport = async () => {
    setExportBusy(true);
    try {
      const n = await exportAssetsToExcel(assets, (id) =>
        revealPassword(id, null, null)
      );
      message.success(`已导出 ${n} 台资产设备（含账号密码，注意保管文件）`);
    } catch (e) {
      message.error(e.message || '导出失败');
    } finally {
      setExportBusy(false);
    }
  };

  /* 导入：解析 Excel → 预览 → 逐条 addAsset */
  const handleImportFile = async (file) => {
    try {
      const payloads = await parseExcelImport(file);
      if (payloads.length === 0) {
        message.warning('文件中没有可导入的资产（缺少「设备名称」列）');
        return false;
      }
      setImportPreview(payloads);
      setImportOpen(true);
    } catch (e) {
      message.error('文件解析失败：' + (e.message || e));
    }
    return false; // 阻止 Upload 默认上传行为
  };

  const doImport = async () => {
    setImporting(true);
    setImportProgress(0);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < importPreview.length; i++) {
      try {
        await addAsset(importPreview[i]);
        ok++;
      } catch (e) {
        fail++;
      }
      setImportProgress(Math.round(((i + 1) / importPreview.length) * 100));
    }
    setImporting(false);
    setImportOpen(false);
    setImportPreview([]);
    setImportProgress(0);
    message.success(
      `导入完成：成功 ${ok} 台${fail ? `，失败 ${fail} 台` : ''}（密码已由服务端加密存储）`
    );
  };

  return (
    <div className="page-card">
      <div className="page-title">
        <span>
          资产设备管理
          {!isAdmin && (
            <Tag style={{ marginLeft: 10 }}>当前用户可见 {assets.length} 台授权设备（服务端过滤）</Tag>
          )}
        </span>
        <Space>
          <Input.Search
            placeholder="搜索名称 / IP / 数据库 / 负责人"
            allowClear
            style={{ width: 250 }}
            onSearch={(v) => setFilter(v)}
            onChange={(e) => setFilter(e.target.value)}
          />
          {isAdmin && (
            <Space>
              <Button
                icon={<UploadOutlined />}
                onClick={() => fileRef.current?.click()}
              >
                导入
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImportFile(f);
                  e.target.value = '';
                }}
              />
              <Button icon={<DownloadOutlined />} loading={exportBusy} onClick={handleExport}>
                导出 Excel
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
                新增资产设备
              </Button>
            </Space>
          )}
        </Space>
      </div>

      <Table
        rowKey="id"
        className="table-ant"
        columns={columns}
        dataSource={filtered}
        onRow={(r) =>
          isAdmin
            ? {
                onClick: () => setDetailId(r.id),
                style: { cursor: 'pointer' },
              }
            : {}
        }
        pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 台设备` }}
      />

      {isAdmin && detailId && (
        <AssetDetailDrawer asset={detailId} currentUser={currentUser} onClose={() => setDetailId(null)} />
      )}

      {isAdmin && addOpen && <AddAssetModal open={addOpen} onCancel={() => setAddOpen(false)} onOk={handleAddAsset} />}

      {/* 导入预览：先展示解析结果，确认后再逐条写入（服务端 AES 加密存储） */}
      {isAdmin && (
      <Modal
        title={
          <Space>
            <UploadOutlined /> 导入资产设备
            <Tag>{importPreview.length} 条待导入</Tag>
          </Space>
        }
        open={importOpen}
        onCancel={() => {
          if (!importing) {
            setImportOpen(false);
            setImportPreview([]);
            setImportProgress(0);
          }
        }}
        onOk={doImport}
        okText="确认导入"
        okButtonProps={{ loading: importing }}
        cancelText="取消"
        width={720}
        destroyOnClose
      >
        <div style={{ marginBottom: 10, fontSize: 13, color: '#5a6a85' }}>
          以下数据将被逐条创建为新资产设备；账号密码导入后由服务端 <b>AES-256-GCM 加密</b> 存储，列表默认密文展示。
        </div>
        {importing && (
          <div style={{ marginBottom: 10 }}>
            <Progress percent={importProgress} size="small" />
          </div>
        )}
        <Table
          rowKey={(r) => r.name}
          size="small"
          pagination={false}
          dataSource={importPreview}
          columns={[
            { title: '设备名称', dataIndex: 'name', width: 140, render: (v) => <b>{v}</b> },
            { title: 'IP', dataIndex: 'ip', width: 110 },
            { title: '环境', dataIndex: 'envType', width: 70 },
            {
              title: '数据库',
              width: 220,
              render: (_, r) => (
                <Space size={4} wrap>
                  {(r.databases || []).map((d, i) => (
                    <Tag key={i}>{`${d.dbType} ${d.dbVersion || ''} :${d.port || '-'}`}</Tag>
                  ))}
                  {(r.databases || []).length === 0 && <Tag>无</Tag>}
                </Space>
              ),
            },
            {
              title: '账号数',
              width: 90,
              render: (_, r) => `${(r.serverAccounts || []).length} 服务器 / ${
                (r.databases || []).reduce((n, d) => n + (d.dbAccounts || []).length, 0)
              } 数据库`,
            },
          ]}
        />
      </Modal>
      )}
    </div>
  );
}
