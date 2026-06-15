import React, { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Switch, Tag, Space, message, Typography, Tooltip,
} from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, EditOutlined } from '@ant-design/icons';
import { getLlmProviders, upsertLlmProvider, toggleLlmProvider } from '../../api';

export default function LlmConfig() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [current, setCurrent] = useState(null);
  const [toggling, setToggling] = useState({});
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLlmProviders();
      setData(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openConfig(record) {
    setCurrent(record);
    form.resetFields();
    form.setFieldsValue({ api_key: '', is_active: record.is_active });
    setModalOpen(true);
  }

  async function onSubmit() {
    const values = await form.validateFields();
    try {
      await upsertLlmProvider(current.provider, values);
      message.success('配置已保存');
      setModalOpen(false);
      load();
    } catch (err) {
      message.error(err?.message || '保存失败');
    }
  }

  async function onToggle(provider) {
    setToggling((prev) => ({ ...prev, [provider]: true }));
    try {
      await toggleLlmProvider(provider);
      load();
    } catch (err) {
      message.error(err?.message || '操作失败');
    } finally {
      setToggling((prev) => ({ ...prev, [provider]: false }));
    }
  }

  const columns = [
    {
      title: '厂商',
      dataIndex: 'name',
      render: (v, r) => <strong>{v}</strong>,
    },
    {
      title: '支持模型',
      dataIndex: 'models',
      render: (models) => (
        <Space size={4} wrap>
          {models.map((m) => <Tag key={m.id} style={{ fontSize: 11 }}>{m.name}</Tag>)}
        </Space>
      ),
    },
    {
      title: 'API Key',
      dataIndex: 'api_key_masked',
      render: (v) => v
        ? <Typography.Text code>{v}</Typography.Text>
        : <Tag color="default">未配置</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 100,
      render: (v, r) => {
        if (!r.is_configured) return <Tag color="default">未配置</Tag>;
        return v
          ? <Tag icon={<CheckCircleOutlined />} color="success">已启用</Tag>
          : <Tag icon={<CloseCircleOutlined />} color="default">已禁用</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openConfig(record)}>
            {record.is_configured ? '更新 Key' : '配置 Key'}
          </Button>
          {record.is_configured && (
            <Tooltip title={record.is_active ? '点击禁用' : '点击启用'}>
              <Switch
                size="small"
                checked={record.is_active}
                loading={toggling[record.provider]}
                onChange={() => onToggle(record.provider)}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>模型配置</Typography.Title>
        <Typography.Text type="secondary">
          在此配置各大模型厂商的 API Key，租户创建时可分配对应模型（套餐）。
        </Typography.Text>
      </div>

      <Table
        rowKey="provider"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={false}
      />

      <Modal
        title={`配置 ${current?.name} API Key`}
        open={modalOpen}
        onOk={onSubmit}
        onCancel={() => setModalOpen(false)}
        width={480}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="api_key"
            label="API Key"
            rules={[{ required: true, message: '请输入 API Key' }]}
            extra={current?.is_configured ? '留空提交无效，当前 Key 已脱敏显示，重新输入将覆盖。' : ''}
          >
            <Input.Password placeholder="sk-..." autoComplete="off" />
          </Form.Item>
          <Form.Item name="is_active" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
