import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Space,
  Popconfirm,
  Empty,
  App as AntApp,
} from 'antd';
import {
  PlusOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  StopOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import {
  useAppData,
  startRecord,
  executeRecord,
  addRecord,
  deleteRecord,
} from '../store';
import { DbTypeTag } from './AssetsPage.jsx';

/* 状态色 */
const STATUS_COLOR = {
  待处理: 'orange',
  处理中: 'processing',
  中止: 'red',
  完成: 'success',
};

/* 目标资产标签 */
function AssetTag({ assetId }) {
  const { assets } = useAppData();
  const a = assets.find((x) => x.id === assetId);
  if (!a) return assetId ? <Tag>未知资产</Tag> : null;
  const dbs = a.databases || [];
  if (dbs.length === 0) return <Tag>{a.name}</Tag>;
  return (
    <Space size={4} wrap>
      {dbs.map((db) => (
        <Space key={db.id} size={4}>
          <DbTypeTag type={db.dbType} />
          <span style={{ fontSize: 12, color: '#5a6a85' }}>
            {db.dbVersion || '未定版本'} :{db.port || '-'}
          </span>
        </Space>
      ))}
      <span style={{ fontSize: 12, color: '#8a97ab' }}>{a.name}</span>
    </Space>
  );
}

/* ---------- 执行弹窗：完成→状态完成；中止→状态中止（均写服务端审计） ---------- */
function ExecuteModal({ record, open, onCancel }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

  /* 打开执行窗口：调用服务端 start，需求单立即进入「处理中」（其他人员实时可见） */
  useEffect(() => {
    if (open && record.status !== '处理中') {
      startRecord(record.id).catch((e) => message.error(e.message || '状态更新失败'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record.id, record.status]);

  const finish = async (resultStatus) => {
    const val = form.getFieldValue('result');
    if (!String(val || '').trim()) {
      message.warning('请输入执行情况');
      return;
    }
    setBusy(true);
    try {
      await executeRecord(record.id, resultStatus, String(val || '').trim());
      message.success(
        resultStatus === '完成' ? '执行完成，执行情况已记录' : '已中止本次执行，状态：中止'
      );
      form.resetFields();
      onCancel();
    } catch (e) {
      message.error(e.message || '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <PlayCircleOutlined /> 执行权限变更
          <Tag color="processing">处理中</Tag>
        </Space>
      }
      open={open}
      onCancel={() => {
        if (!busy) {
          form.resetFields();
          onCancel();
        }
      }}
      footer={
        <Space>
          <Button danger icon={<StopOutlined />} onClick={() => finish('中止')} loading={busy}>
            中止
          </Button>
          <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => finish('完成')} loading={busy}>
            完成
          </Button>
        </Space>
      }
      destroyOnClose
    >
      <p style={{ color: '#5a6a85', fontSize: 13 }}>
        执行窗口已开启，该需求单状态为 <Tag color="processing">处理中</Tag>，其他人员此时看到的是「处理中」。点击「完成」后执行情况显示完成；点击「中止」则状态为中止（服务端全程审计）。
      </p>
      <Form form={form} layout="vertical">
        <Form.Item name="result" label="执行情况">
          <Input.TextArea
            rows={4}
            placeholder="请输入执行情况（如：已执行 GRANT SELECT ON ... 并验证通过）"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/* ---------- 主页面 ---------- */
export default function ChangesPage({ currentUser }) {
  const appData = useAppData();
  const { changeRecords, assets } = appData;
  const { message } = AntApp.useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();
  const [execId, setExecId] = useState(null);
  const [viewId, setViewId] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const topRef = useRef(null);
  const isAdmin = currentUser.role === '管理员';

  const viewRecord = viewId ? changeRecords.find((r) => r.id === viewId) : null;
  const execRecord = execId ? changeRecords.find((r) => r.id === execId) : null;

  /* 服务端已按角色/授权资产过滤，前端直接使用 */
  const visibleRecords = changeRecords;

  useEffect(() => {
    if (highlightId) {
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [highlightId, changeRecords.length]);

  /* 新增需求：服务端创建后自动刷新列表；置顶高亮定位到第一条 */
  const submitNew = async () => {
    const v = await addForm.validateFields();
    try {
      const id = await addRecord({
        applicant: v.applicant.trim(),
        assetId: v.assetId,
        requirement: v.requirement.trim(),
      });
      addForm.resetFields();
      setAddOpen(false);
      setHighlightId(id || 'first');
      message.success('需求已提交，状态：待处理');
      setTimeout(() => setHighlightId(null), 4000);
    } catch (e) {
      message.error(e.message || '提交失败');
    }
  };

  const del = async (id) => {
    try {
      await deleteRecord(id);
      message.success('需求单已删除');
    } catch (e) {
      message.error(e.message || '删除失败');
    }
  };

  // 新增后 highlightId 为 'first'，对应列表第一条（服务端按创建时间倒序）
  const isHighlight = (r) => highlightId === 'first' ? r === visibleRecords[0] : r.id === highlightId;

  return (
    <div className="page-card">
      <div className="page-title">
        <span>数据库权限变更记录</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          新增需求
        </Button>
      </div>

      <div ref={topRef} />
      {visibleRecords.length === 0 && <Empty description="暂无需求单" />}

      {visibleRecords.map((r) => {
        const done = r.status === '完成';
        return (
          <div
            key={r.id}
            className="record-card"
            style={isHighlight(r) ? { outline: '2px solid #1a6bd8', outlineOffset: 2 } : null}
          >
            <div className="record-head">
              <div style={{ flex: 1, minWidth: 260 }}>
                <Space size={10} wrap style={{ marginBottom: 8 }}>
                  <Tag color={STATUS_COLOR[r.status] || 'default'}>{r.status}</Tag>
                  <span style={{ fontSize: 13, color: '#5a6a85' }}>
                    申请人：<b style={{ color: '#1f2d45' }}>{r.applicant}</b>
                  </span>
                  <span style={{ fontSize: 13, color: '#5a6a85' }}>
                    目标资产：<AssetTag assetId={r.assetId} />
                  </span>
                </Space>
                <div style={{ fontSize: 13, color: '#33415c', lineHeight: 1.7 }}>
                  <b>申请要求：</b>
                  {r.requirement}
                </div>
                {r.executions.length > 0 && (
                  <div style={{ fontSize: 12, color: '#8a97ab', marginTop: 6 }}>
                    已有 {r.executions.length} 条执行记录，点击「查看」查看执行情况
                  </div>
                )}
              </div>
              {isAdmin && (
                <Space>
                  {!done && (
                    <Button
                      size="small"
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      onClick={() => setExecId(r.id)}
                    >
                      执行
                    </Button>
                  )}
                  <Button size="small" icon={<EyeOutlined />} onClick={() => setViewId(r.id)}>
                    查看
                  </Button>
                  <Popconfirm
                    title="确认删除该需求单？"
                    onConfirm={() => del(r.id)}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              )}
            </div>
          </div>
        );
      })}

      {/* 新增需求弹窗 */}
      <Modal
        title="新增权限变更需求"
        open={addOpen}
        onCancel={() => {
          addForm.resetFields();
          setAddOpen(false);
        }}
        onOk={submitNew}
        okText="提交并跳转"
        destroyOnClose
      >
        <Form form={addForm} layout="vertical">
          <Form.Item
            name="applicant"
            label="申请人"
            rules={[{ required: true, message: '请输入申请人' }]}
          >
            <Input placeholder="请输入申请人" allowClear />
          </Form.Item>
          <Form.Item
            name="assetId"
            label="目标资产（普通用户仅限授权资产，服务端二次校验）"
            rules={[{ required: true, message: '请选择目标资产' }]}
          >
            <Select
              placeholder="请选择目标资产"
              showSearch
              optionFilterProp="label"
              options={assets.map((a) => ({
                value: a.id,
                label: `${a.name}（${(a.databases || [])
                  .map((d) => `${d.dbType} ${d.dbVersion || ''} :${d.port || '-'}`)
                  .join(' / ') || '未配置数据库'}）`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="requirement"
            label="申请要求"
            rules={[{ required: true, message: '请输入申请要求' }]}
          >
            <Input.TextArea rows={4} placeholder="如：为 xxx 账号开通 xxx 库的 xxx 权限" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 执行弹窗（仅管理员） */}
      {execRecord && (
        <ExecuteModal record={execRecord} open={!!execId} onCancel={() => setExecId(null)} />
      )}

      {/* 查看弹窗：执行结果在此显示 */}
      <Modal
        title={
          <Space>
            查看需求单
            {viewRecord && <Tag color={STATUS_COLOR[viewRecord.status]}>{viewRecord.status}</Tag>}
          </Space>
        }
        open={!!viewRecord}
        onCancel={() => setViewId(null)}
        footer={<Button onClick={() => setViewId(null)}>关闭</Button>}
        width={600}
      >
        {viewRecord && (
          <div style={{ fontSize: 13, lineHeight: 2 }}>
            <div>
              <b>申请人：</b>
              {viewRecord.applicant}
            </div>
            <div>
              <b>目标资产：</b>
              <AssetTag assetId={viewRecord.assetId} />
            </div>
            <div>
              <b>申请要求：</b>
              {viewRecord.requirement}
            </div>
            <div style={{ marginTop: 8, fontWeight: 600, color: '#24365a' }}>执行情况：</div>
            {viewRecord.executions.length === 0 ? (
              <Tag color="orange">暂无执行记录</Tag>
            ) : (
              viewRecord.executions.map((e) => (
                <div key={e.id} className="record-exec" style={{ margin: '0 0 8px' }}>
                  <Tag color={e.result.startsWith('执行中止') ? 'red' : 'success'}>
                    {e.result.startsWith('执行中止') ? '中止' : '完成'}
                  </Tag>
                  <span style={{ marginLeft: 8 }}>{e.result}</span>
                  <div style={{ color: '#8a97ab', fontSize: 12, marginTop: 4 }}>
                    执行人：{e.executor || '-'} · {e.time}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
