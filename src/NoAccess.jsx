import React from 'react';
import { Alert, Tag } from 'antd';

export default function NoAccess({ label }) {
  return (
    <div className="page-card">
      <div className="page-title">
        <span>{label}</span>
      </div>
      <Alert
        type="warning"
        showIcon
        message={
          <span>
            无权限：<Tag color="orange">{label}</Tag> 仅管理员可见
          </span>
        }
        description="如需访问请联系管理员为您开通相应角色。"
      />
    </div>
  );
}
