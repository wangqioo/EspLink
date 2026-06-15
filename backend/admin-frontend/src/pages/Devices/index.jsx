import React, { useEffect, useState, useCallback } from 'react';
import { Table, Button, Space, Popconfirm, message, Tag, Badge, Typography, Select, Input, Tooltip, Modal, Form } from 'antd';
import { ReloadOutlined, DisconnectOutlined, LinkOutlined } from '@ant-design/icons';
import { getDevices, kickDevice, unbindDevice, assignDeviceKey, getKeys } from '../../api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

function getAdminStatus(record) {
  const rawStatus = typeof record.admin_status === 'string' ? record.admin_status : null;
  if (['online', 'stale_or_unknown', 'offline'].includes(rawStatus)) return rawStatus;

  if (typeof record.ws_connected === 'boolean') {
    if (record.ws_connected) return 'online';
    if (record.db_online === true) return 'stale_or_unknown';
    return 'offline';
  }

  if (typeof record.db_online === 'boolean') {
    return record.db_online ? 'stale_or_unknown' : 'offline';
  }

  if (typeof record.is_online === 'boolean') {
    return record.is_online ? 'online' : 'offline';
  }

  return 'stale_or_unknown';
}

function renderOnlineStatus(record) {
  const status = getAdminStatus(record);
  const badgeStatus = {
    online: 'success',
    stale_or_unknown: 'warning',
    offline: 'default',
  }[status];
  const details = [
    typeof record.ws_connected === 'boolean' ? `WS: ${record.ws_connected ? 'connected' : 'disconnected'}` : null,
    typeof record.db_online === 'boolean' ? `DB: ${record.db_online ? 'online' : 'offline'}` : null,
    typeof record.seconds_since_seen === 'number' ? `seen ${record.seconds_since_seen}s ago` : null,
  ].filter(Boolean).join(' / ');

  const badge = <Badge status={badgeStatus} text={status} />;
  return details ? <Tooltip title={details}>{badge}</Tooltip> : badge;
}

function normalizeCapabilities(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
      return normalizeCapabilities(JSON.parse(trimmed)) || trimmed;
    } catch {
      return trimmed;
    }
  }
  if (typeof value === 'object') {
    try {
      return Object.entries(value)
        .filter(([, item]) => item !== undefined && item !== null && item !== false)
        .map(([key, item]) => {
          if (item === true) return key;
          if (Array.isArray(item)) return `${key}: ${item.filter(Boolean).join(', ')}`;
          if (typeof item === 'object') return `${key}: ${normalizeCapabilities(item) || 'yes'}`;
          return `${key}: ${item}`;
        })
        .filter(Boolean)
        .join(' / ');
    } catch {
      return '';
    }
  }
  return String(value);
}

function renderCapabilities(record) {
  const summary = normalizeCapabilities(record.capabilities_summary) || normalizeCapabilities(record.capabilities);
  if (!summary) return '—';
  return (
    <Typography.Text style={{ maxWidth: 260 }} ellipsis={{ tooltip: summary }}>
      {summary}
    </Typography.Text>
  );
}

export default function Devices() {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({});
  const [assignModal, setAssignModal] = useState(null); // mac_address
  const [keys, setKeys] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDevices({ page, pageSize: 20, ...filters });
      setData(res.data.list);
      setTotal(res.data.pagination.total);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  // 每30秒自动刷新在线状态
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  function openAssign(mac) {
    setAssignModal(mac);
    setSelectedKey(null);
    getKeys({ pageSize: 100, isActive: 'true' }).then((res) => setKeys(res.data.list));
  }

  async function doAssign() {
    if (!selectedKey) return message.warning('请选择一个 API Key');
    try {
      await assignDeviceKey(assignModal, selectedKey);
      message.success('分配成功');
      setAssignModal(null);
      load();
    } catch (err) {
      message.error(err?.message || '分配失败');
    }
  }

  async function doKick(mac) {
    try {
      await kickDevice(mac);
      message.success('已强制下线');
      load();
    } catch (err) {
      message.error(err?.message || '操作失败');
    }
  }

  async function doUnbind(mac) {
    try {
      await unbindDevice(mac);
      message.success('已解绑');
      load();
    } catch (err) {
      message.error(err?.message || '操作失败');
    }
  }

  const columns = [
    {
      title: '在线',
      key: 'online',
      width: 150,
      render: (_, record) => renderOnlineStatus(record),
    },
    {
      title: 'MAC 地址',
      dataIndex: 'mac_address',
      render: (v) => <code style={{ fontSize: 12 }}>{v}</code>,
    },
    {
      title: '设备名 / ID',
      key: 'name',
      render: (_, r) => (
        <div>
          <div>{r.name || <span style={{ color: '#aaa' }}>未命名</span>}</div>
          {r.device_id && <div style={{ fontSize: 11, color: '#888' }}>{r.device_id}</div>}
        </div>
      ),
    },
    {
      title: '板型',
      dataIndex: 'board_type',
      width: 120,
      render: (v) => v ? <Tag>{v}</Tag> : '—',
    },
    {
      title: '能力摘要',
      key: 'capabilities',
      width: 280,
      render: (_, record) => renderCapabilities(record),
    },
    { title: '固件版本', dataIndex: 'firmware', render: (v) => v || '—' },
    {
      title: '配对状态',
      dataIndex: 'is_paired',
      render: (v) => <Tag color={v ? 'green' : 'orange'}>{v ? '已配对' : '未配对'}</Tag>,
    },
    {
      title: '绑定 Key',
      dataIndex: 'api_key',
      render: (v) => v ? <Tooltip title={v.id}><Tag color="blue">{v.name || v.id.slice(0, 12) + '…'}</Tag></Tooltip> : <span style={{ color: '#aaa' }}>未绑定</span>,
    },
    {
      title: '最后在线',
      dataIndex: 'last_seen',
      render: (v) => v ? dayjs(v).fromNow() : '—',
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<LinkOutlined />} onClick={() => openAssign(record.mac_address)}>分配Key</Button>
          <Popconfirm title="确认强制下线？" onConfirm={() => doKick(record.mac_address)}>
            <Button size="small" icon={<DisconnectOutlined />}>下线</Button>
          </Popconfirm>
          <Popconfirm title="解绑后设备将失去API Key，确认？" onConfirm={() => doUnbind(record.mac_address)}>
            <Button size="small" danger>解绑</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>设备管理</Typography.Title>
        <Space>
          <Input.Search
            placeholder="搜索MAC/名称/设备ID"
            onSearch={(v) => { setFilters((f) => ({ ...f, search: v })); setPage(1); }}
            allowClear
            style={{ width: 220 }}
          />
          <Select
            placeholder="配对状态"
            allowClear
            style={{ width: 120 }}
            options={[{ value: 'true', label: '已配对' }, { value: 'false', label: '未配对' }]}
            onChange={(v) => { setFilters((f) => ({ ...f, isPaired: v })); setPage(1); }}
          />
          <Select
            placeholder="在线状态"
            allowClear
            style={{ width: 120 }}
            options={[{ value: 'true', label: '在线' }, { value: 'false', label: '离线' }]}
            onChange={(v) => { setFilters((f) => ({ ...f, isOnline: v })); setPage(1); }}
          />
          <Button
            icon={<ReloadOutlined spin={autoRefresh} />}
            onClick={() => setAutoRefresh((v) => !v)}
            type={autoRefresh ? 'primary' : 'default'}
          >
            {autoRefresh ? '自动刷新中' : '自动刷新'}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
        </Space>
      </div>

      <Table
        rowKey="mac_address"
        columns={columns}
        dataSource={data}
        loading={loading}
        scroll={{ x: 1200 }}
        pagination={{ current: page, total, pageSize: 20, onChange: setPage, showTotal: (t) => `共 ${t} 台设备` }}
      />

      <Modal
        title="为设备分配 API Key"
        open={!!assignModal}
        onOk={doAssign}
        onCancel={() => setAssignModal(null)}
      >
        <p style={{ color: '#888', marginBottom: 12 }}>MAC: <code>{assignModal}</code></p>
        <Select
          style={{ width: '100%' }}
          placeholder="选择要分配的 API Key"
          showSearch
          optionFilterProp="label"
          options={keys.map((k) => ({ value: k.id, label: `${k.name || '未命名'} — ${k.tenant?.name} — ${k.id.slice(0, 16)}…` }))}
          onChange={setSelectedKey}
        />
      </Modal>
    </div>
  );
}
