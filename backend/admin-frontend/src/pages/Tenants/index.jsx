import React, { useEffect, useState, useCallback } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Select, Space, Popconfirm, message, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { getTenants, createTenant, updateTenant, deleteTenant, getLlmModels } from '../../api';

const LEVEL_COLORS = { free: 'default', pro: 'blue', enterprise: 'gold' };

export default function Tenants() {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [modelOptions, setModelOptions] = useState([]);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTenants({ page, pageSize: 20, search });
      setData(res.data.list);
      setTotal(res.data.pagination.total);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    getLlmModels().then((res) => {
      const grouped = {};
      for (const m of res.data) {
        if (!grouped[m.providerName]) grouped[m.providerName] = [];
        grouped[m.providerName].push({ value: m.id, label: m.name });
      }
      setModelOptions(
        Object.entries(grouped).map(([label, options]) => ({ label, options }))
      );
    }).catch(() => {});
  }, []);

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ level: 'free', daily_limit: 1000, monthly_limit: 10000, alert_threshold: 80 });
    setModalOpen(true);
  }

  function openEdit(record) {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      level: record.level,
      daily_limit: record.daily_limit,
      monthly_limit: record.monthly_limit,
      usage_alert_webhook: record.usage_alert_webhook || '',
      alert_threshold: Math.round(record.alert_threshold * 100),
      ai_model: record.ai_model || undefined,
    });
    setModalOpen(true);
  }

  async function onSubmit() {
    const values = await form.validateFields();
    const payload = { ...values, alert_threshold: values.alert_threshold / 100 };
    try {
      if (editing) {
        await updateTenant(editing.id, payload);
        message.success('更新成功');
      } else {
        await createTenant(payload);
        message.success('创建成功');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      message.error(err?.message || '操作失败');
    }
  }

  async function onDelete(id) {
    try {
      await deleteTenant(id);
      message.success('删除成功');
      load();
    } catch (err) {
      message.error(err?.message || '删除失败');
    }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '租户名称', dataIndex: 'name', render: (v) => <strong>{v}</strong> },
    { title: '等级', dataIndex: 'level', render: (v) => <Tag color={LEVEL_COLORS[v]}>{v.toUpperCase()}</Tag> },
    { title: 'AI 模型', dataIndex: 'ai_model', render: (v) => v ? <Tag color="blue">{v}</Tag> : <span style={{ color: '#aaa' }}>默认</span> },
    { title: '日限额', dataIndex: 'daily_limit', render: (v) => v.toLocaleString() },
    { title: '月限额', dataIndex: 'monthly_limit', render: (v) => v.toLocaleString() },
    { title: 'Key数', dataIndex: '_count', render: (v) => v?.api_keys ?? 0 },
    { title: '设备数', dataIndex: '_count', key: 'devices', render: (v) => v?.devices ?? 0 },
    {
      title: '操作', key: 'action', width: 160,
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm title="确认删除该租户？删除后关联Key和设备将一并删除。" onConfirm={() => onDelete(record.id)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>租户管理</Typography.Title>
        <Space>
          <Input.Search placeholder="搜索租户名称" onSearch={(v) => { setSearch(v); setPage(1); }} allowClear style={{ width: 220 }} />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建租户</Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={{ current: page, total, pageSize: 20, onChange: setPage, showTotal: (t) => `共 ${t} 条` }}
      />

      <Modal title={editing ? '编辑租户' : '新建租户'} open={modalOpen} onOk={onSubmit} onCancel={() => setModalOpen(false)} width={520}>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="租户名称" rules={[{ required: true, message: '请输入租户名称' }]}>
            <Input placeholder="例：张三的设备" />
          </Form.Item>
          <Form.Item name="level" label="等级">
            <Select options={[{ value: 'free', label: 'Free' }, { value: 'pro', label: 'Pro' }, { value: 'enterprise', label: 'Enterprise' }]} />
          </Form.Item>
          <Form.Item name="ai_model" label="AI 模型（套餐）" extra="不选则使用系统默认模型">
            <Select
              placeholder="选择分配给该租户的模型"
              allowClear
              options={modelOptions}
            />
          </Form.Item>
          <Form.Item name="daily_limit" label="每日调用限额">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="monthly_limit" label="每月调用限额">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="alert_threshold" label="告警阈值（%）" extra="用量达到该百分比时触发Webhook告警">
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="usage_alert_webhook" label="告警 Webhook URL">
            <Input placeholder="https://oapi.dingtalk.com/robot/..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
