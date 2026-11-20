import React, { useState } from 'react';
import {
  Button,
  Input,
  Tag,
  Space,
  App as AntApp,
  Alert,
} from 'antd';
import {
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  useAppData,
  saveConfig,
  DB_TYPE_COLORS,
  DB_TYPE_COLOR_FALLBACK,
  DEFAULT_PORT,
} from '../store';

/* 通用：可增删的标签列表编辑（本地编辑，点击「保存配置」统一提交服务端） */
function TagEditor({ items, onChange, placeholder, allowDuplicate = false }) {
  const [val, setVal] = useState('');
  const add = () => {
    const v = val.trim();
    if (!v) return;
    if (!allowDuplicate && items.includes(v)) return;
    onChange([...items, v]);
    setVal('');
  };
  return (
    <div>
      <div className="tag-list">
        {items.map((t) => (
          <Tag
            key={t}
            closable
            onClose={(e) => {
              e.preventDefault();
              onChange(items.filter((x) => x !== t));
            }}
          >
            {t}
          </Tag>
        ))}
        {items.length === 0 && <Tag>（空）</Tag>}
      </div>
      <Space.Compact style={{ width: '100%', marginTop: 10 }}>
        <Input
          placeholder={placeholder}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onPressEnter={add}
        />
        <Button icon={<PlusOutlined />} onClick={add}>
          添加
        </Button>
      </Space.Compact>
    </div>
  );
}

export default function ConfigPage({ currentUser }) {
  const appData = useAppData();
  const { config } = appData;
  const { message } = AntApp.useApp();
  const [draft, setDraft] = useState(null); // 本地草稿，保存后提交服务端
  const [saving, setSaving] = useState(false);
  const [portInput, setPortInput] = useState('');
  const isAdmin = currentUser?.role === '管理员';

  /* 编辑在本地草稿上进行，点击「保存配置」提交；保存后草稿与服务器一致 */
  const cfg = draft || config;
  const isDirty = JSON.stringify(cfg) !== JSON.stringify(config);

  const update = (fn) => {
    const next = JSON.parse(JSON.stringify(cfg));
    fn(next);
    setDraft(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveConfig(cfg);
      setDraft(null);
      message.success('配置已保存（服务端存储）');
      void saved;
    } catch (e) {
      message.error(e.message || '保存失败（仅管理员可修改配置）');
    } finally {
      setSaving(false);
    }
  };

  const addDbType = (type) => {
    const t = type.trim();
    if (!t || cfg.dbTypes.includes(t)) return;
    update((c) => {
      c.dbTypes.push(t);
    });
    message.success(`数据库类型「${t}」已添加，点击「保存配置」生效`);
  };

  const removeDbType = (type) =>
    update((c) => {
      c.dbTypes = c.dbTypes.filter((x) => x !== type);
    });

  return (
    <div className="page-card">
      <div className="page-title">
        <span>配置管理（服务端存储）</span>
        <Space>
          {isAdmin && (
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              disabled={!isDirty}
              onClick={save}
            >
              保存配置{isDirty ? '（有未保存修改）' : ''}
            </Button>
          )}
        </Space>
      </div>

      <Alert
        message="数据库版本在新增资产时手动填写；数据库类型与端口可在此处配置。普通用户只读，管理员保存后全端生效。"
        type="info"
        showIcon
        style={{ marginBottom: 16, maxWidth: 560 }}
      />
      {isDirty && (
        <Alert
          message="存在未保存的修改，点击「保存配置」提交到服务端（服务端审计留痕）"
          type="warning"
          showIcon
          style={{ marginBottom: 16, maxWidth: 560 }}
        />
      )}

      <div className="config-grid">
        <div className="config-block">
          <h4>环境类型配置</h4>
          <TagEditor
            items={cfg.envTypes || []}
            onChange={(next) =>
              update((c) => {
                c.envTypes = next;
              })
            }
            placeholder="如：正式 / 测试 / 开发"
          />
        </div>

        <div className="config-block">
          <h4>执行情况状态</h4>
          <TagEditor
            items={cfg.execStatus || []}
            onChange={(next) =>
              update((c) => {
                c.execStatus = next;
              })
            }
            placeholder="如：待处理 / 处理中 / 中止 / 完成"
          />
          <div style={{ marginTop: 8, fontSize: 12, color: '#8a97ab' }}>
            需求单状态流转：待处理 → 处理中 → 完成 / 中止
          </div>
        </div>

        <div className="config-block">
          <h4>
            <Space>
              端口配置
              <span style={{ fontSize: 12, color: '#8a97ab', fontWeight: 400 }}>
                资产新增/编辑时可选端口
              </span>
            </Space>
          </h4>
          <div className="tag-list">
            {(cfg.ports || []).map((p) => (
              <Tag
                key={p}
                closable
                onClose={(e) => {
                  e.preventDefault();
                  update((c) => {
                    c.ports = c.ports.filter((x) => x !== p);
                  });
                }}
              >
                {p}
              </Tag>
            ))}
          </div>
          <Space.Compact style={{ width: '100%', marginTop: 10 }}>
            <Input
              placeholder="如：1521 / 3306 / 5432"
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              onPressEnter={() => {
                if (portInput.trim())
                  update((c) => {
                    if (!(c.ports || []).includes(portInput.trim())) c.ports = [...(c.ports || []), portInput.trim()];
                  });
                setPortInput('');
              }}
            />
            <Button
              icon={<PlusOutlined />}
              onClick={() => {
                if (portInput.trim())
                  update((c) => {
                    if (!(c.ports || []).includes(portInput.trim())) c.ports = [...(c.ports || []), portInput.trim()];
                  });
                setPortInput('');
              }}
            >
              添加
            </Button>
          </Space.Compact>
        </div>

        <div className="config-block" style={{ gridColumn: '1 / -1' }}>
          <h4>
            <Space>
              数据库类型配置
              <span style={{ fontSize: 12, color: '#8a97ab', fontWeight: 400 }}>
                数据库版本由新增资产时手动填写，此处仅管理数据库类型
              </span>
              {isAdmin && (
                <Button
                  type="link"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    const t = window.prompt('输入新数据库类型：');
                    if (t) addDbType(t);
                  }}
                >
                  新增类型
                </Button>
              )}
            </Space>
          </h4>
          <div className="tag-list">
            {(cfg.dbTypes || []).map((t) => (
              <Tag
                key={t}
                style={{
                  background: (DB_TYPE_COLORS[t] || DB_TYPE_COLOR_FALLBACK).bg,
                  color: (DB_TYPE_COLORS[t] || DB_TYPE_COLOR_FALLBACK).color,
                  borderColor: (DB_TYPE_COLORS[t] || DB_TYPE_COLOR_FALLBACK).bg,
                  fontWeight: 600,
                }}
                closable={isAdmin}
                onClose={(e) => {
                  e.preventDefault();
                  removeDbType(t);
                }}
              >
                {t}
              </Tag>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#8a97ab' }}>
            各类型官方默认端口参考：
            {Object.entries(DEFAULT_PORT).map(([k, v]) => `${k}=${v}`).join(' · ')}
          </div>
        </div>
      </div>
    </div>
  );
}
