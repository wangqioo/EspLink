import React, { useEffect, useState, useCallback } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Select, Space, Popconfirm, message, Tag, Switch, Typography, Tooltip } from 'antd';
import { PlusOutlined, CopyOutlined, ReloadOutlined } from '@ant-design/icons';
import { getKeys, createKey, updateKey, deleteKey, resetKeyUsage, getTenants } from '../../api';
import dayjs from 'dayjs';

export default function ApiKeys() {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [tenants, setTenants] = useState([]);
  const [filters, setFilters] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getKeys({ page, pageSize: 20, ...filters });
      setData(res.data.list);
      setTotal(res.data.pagination.total);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    getTenants({ pageSize: 100 }).then((res) => setTenants(res.data.list));
  }, []);

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  }

  function openEdit(record) {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      tenantId: record.tenant_id,
      dailyLimit: record.daily_limit,
      monthlyLimit: record.monthly_limit,
      deviceLimit: record.device_limit,
    });
    setModalOpen(true);
  }

  async function onSubmit() {
    const values = await form.validateFields();
    try {
      if (editing) {
        await updateKey(editing.id, values);
        message.success('更新成功');
      } else {
        await createKey(values);
        message.success('创建成功');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      message.error(err?.message || '操作失败');
    }
  }

  async function onToggle(record, checked) {
    try {
      await updateKey(record.id, { isActive: checked });
      message.success(checked ? '已启用' : '已禁用');
      load();
    } catch {
      message.error('操作失败');
    }
  }

  async function onReset(id) {
    try {
      await resetKeyUsage(id);
      message.success('用量已重置');
      load();
    } catch {
      message.error('重置失败');
    }
  }

  function copyKey(id) {
    navigator.clipboard.writeText(id).then(() => message.success('已复制'));
  }

  const columns = [
    {
      title: 'API Key', dataIndex: 'id', ellipsis: true, width: 240,
      render: (v) => (
        <Space>
          <code style={{ fontSize: 12 }}>{v.slice(0, 20)}…</code>
          <Tooltip title="复制完整Key"><CopyOutlined style={{ cursor: 'pointer', color: '#1677ff' }} onClick={() => copyKey(v)} /></Tooltip>
        </Space>
      ),
    },
    { title: '名称', dataIndex: 'name', render: (v) => v || <span style={{ color: '#aaa' }}>—</span> },
    { title: '租户', dataIndex: 'tenant', render: (v) => v?.name },
    { title: '今日/日限', key: 'today', render: (_, r) => `${r.used_today} / ${r.daily_limit ?? '∞'}` },
    { title: '本月/月限', key: 'month', render: (_, r) => `${r.used_month} / ${r.monthly_limit ?? '∞'}` },
    { title: '过期时间', dataIndex: 'expires_at', render: (v) => v ? dayjs(v).format('YYYY-MM-DD') : '永不过期' },
    {
      title: '状态', dataIndex: 'is_active',
      render: (v, record) => <Switch checked={v} size="small" onChange={(c) => onToggle(record, c)} />,
    },
    {
      title: '操作', key: 'action', width: 200,
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm title="确认重置用量计数？" onConfirm={() => onReset(record.id)}>
            <Button size="small" icon={<ReloadOutlined />}>重置</Button>
          </Popconfirm>
          <Popconfirm title="确认删除该API Key？" onConfirm={async () => { await deleteKey(record.id); load(); }}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>API Key 管理</Typography.Title>
        <Space>
          <Select
            placeholder="筛选租户"
            allowClear
            style={{ width: 160 }}
            options={tenants.map((t) => ({ value: t.id, label: t.name }))}
            onChange={(v) => { setFilters((f) => ({ ...f, tenantId: v })); setPage(1); }}
          />
          <Select
            placeholder="筛选状态"
            allowClear
            style={{ width: 120 }}
            options={[{ value: 'true', label: '启用' }, { value: 'false', label: '禁用' }]}
            onChange={(v) => { setFilters((f) => ({ ...f, isActive: v })); setPage(1); }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>生成 Key</Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={{ current: page, total, pageSize: 20, onChange: setPage, showTotal: (t) => `共 ${t} 条` }}
      />

      <Modal title={editing ? '编辑 API Key' : '生成新 API Key'} open={modalOpen} onOk={onSubmit} onCancel={() => setModalOpen(false)} width={480}>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {!editing && (
            <Form.Item name="tenantId" label="所属租户" rules={[{ required: true, message: '请选择租户' }]}>
              <Select placeholder="选择租户" options={tenants.map((t) => ({ value: t.id, label: t.name }))} />
            </Form.Item>
          )}
          <Form.Item name="name" label="Key名称">
            <Input placeholder="例：生产设备组-001" />
          </Form.Item>
          <Form.Item name="dailyLimit" label="日调用限额（留空使用租户默认值）">
            <InputNumber min={1} style={{ width: '100%' }} placeholder="不填则继承租户设置" />
          </Form.Item>
          <Form.Item name="monthlyLimit" label="月调用限额">
            <InputNumber min={1} style={{ width: '100%' }} placeholder="不填则继承租户设置" />
          </Form.Item>
          <Form.Item name="deviceLimit" label="可绑定设备数量">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
