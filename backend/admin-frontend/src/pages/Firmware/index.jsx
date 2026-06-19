import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Table, Button, Form, Input, InputNumber, Modal, Row, Col, Select, Space, Switch, Tag, Typography, message, Tooltip, Upload } from 'antd';
import { PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import { createFirmwareRelease, getFirmwareReleases, previewFirmwareOta, setFirmwareReleaseActive, uploadFirmwareArtifact } from '../../api';
import dayjs from 'dayjs';

const DEFAULT_CHANNEL = 'stable';

function inferReleaseFields(filename) {
  const match = filename.match(/^(.+)-(\d+\.\d+\.\d+)\.bin$/i);
  if (!match) return {};
  return {
    board_type: match[1],
    version: match[2],
  };
}

function renderVersion(record) {
  return (
    <Space size={6}>
      <Tag color="blue">{record.version}</Tag>
      {record.force_update && <Tag color="red">强制</Tag>}
    </Space>
  );
}

function renderArtifactUrl(url) {
  if (!url) return '—';
  return (
    <Typography.Text style={{ maxWidth: 320 }} ellipsis={{ tooltip: url }}>
      {url}
    </Typography.Text>
  );
}

function renderChecksum(value) {
  if (!value) return '—';
  return (
    <Tooltip title={value}>
      <code style={{ fontSize: 12 }}>{value.slice(0, 16)}…</code>
    </Tooltip>
  );
}

function renderOtaSummary(summary) {
  if (!summary || summary.total === 0) return '—';
  const failure = summary.last_failure;
  return (
    <Space direction="vertical" size={2}>
      <Space size={4} wrap>
        <Tag color="green">成功 {summary.success}</Tag>
        <Tag color={summary.failed > 0 ? 'red' : 'default'}>失败 {summary.failed}</Tag>
        {summary.in_progress > 0 && <Tag color="processing">进行中 {summary.in_progress}</Tag>}
      </Space>
      {failure && (
        <Tooltip title={failure.error_message || failure.error_code || failure.status}>
          <Typography.Text type="danger" style={{ fontSize: 12 }}>
            最近失败：{failure.error_code || failure.status}
          </Typography.Text>
        </Tooltip>
      )}
    </Space>
  );
}

function buildRepresentativeFirmwareVersion(version, forceUpdate) {
  if (forceUpdate) return version;
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return '0.0.0';
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (patch > 0) return `${major}.${minor}.${patch - 1}`;
  if (minor > 0) return `${major}.${minor - 1}.0`;
  if (major > 0) return `${major - 1}.0.0`;
  return '0.0.0';
}

export default function Firmware() {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingArtifact, setUploadingArtifact] = useState(false);
  const [preview, setPreview] = useState(null);
  const [createdRelease, setCreatedRelease] = useState(null);
  const [form] = Form.useForm();
  const watchedBoardType = Form.useWatch('board_type', form);
  const watchedVersion = Form.useWatch('version', form);
  const watchedChannel = Form.useWatch('channel', form);

  const duplicateRelease = data.find((item) => (
    item.board_type === watchedBoardType
    && item.version === watchedVersion
    && item.channel === (watchedChannel || DEFAULT_CHANNEL)
  ));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getFirmwareReleases({ page, pageSize: 20, ...filters });
      setData(res.data.list);
      setTotal(res.data.pagination.total);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    form.resetFields();
    setUploadingArtifact(false);
    setPreview(null);
    setCreatedRelease(null);
    form.setFieldsValue({
      channel: DEFAULT_CHANNEL,
      is_active: true,
      force_update: false,
    });
    setModalOpen(true);
  }

  async function onSubmit() {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const res = await createFirmwareRelease({
        ...values,
        release_notes: values.release_notes || null,
        size_bytes: values.size_bytes ?? null,
      });
      message.success('固件发布已创建');
      setCreatedRelease(res.data);
      setPage(1);
      await load();
      await loadPreview({
        board_type: values.board_type,
        firmware_version: buildRepresentativeFirmwareVersion(values.version, values.force_update),
        channel: values.channel || DEFAULT_CHANNEL,
      });
    } catch (err) {
      message.error(err?.message || '创建失败');
    } finally {
      setSubmitting(false);
    }
  }

  function closeCreateModal() {
    setModalOpen(false);
    setPreview(null);
    setCreatedRelease(null);
  }

  async function onArtifactSelected(file) {
    if (!file.name.toLowerCase().endsWith('.bin')) {
      message.error('请选择 .bin 固件文件');
      return Upload.LIST_IGNORE;
    }

    setUploadingArtifact(true);
    try {
      const res = await uploadFirmwareArtifact(file);
      const artifact = res.data;
      const inferred = inferReleaseFields(artifact.filename);
      const current = form.getFieldsValue(['board_type', 'version']);
      form.setFieldsValue({
        ...(!current.board_type && inferred.board_type ? { board_type: inferred.board_type } : {}),
        ...(!current.version && inferred.version ? { version: inferred.version } : {}),
        artifact_url: artifact.artifact_url,
        sha256: artifact.sha256,
        size_bytes: artifact.size_bytes,
      });
      message.success('固件已上传，地址、SHA256 和大小已自动填入');
    } catch (err) {
      message.error(err?.message || '固件上传失败');
    } finally {
      setUploadingArtifact(false);
    }

    return false;
  }

  async function onToggle(record, checked) {
    if (!checked) {
      const ok = await new Promise((resolve) => {
        Modal.confirm({
          title: '停用固件发布',
          content: `确认停用 ${record.board_type} / ${record.version}？停用后设备不会再收到该版本 OTA。`,
          okText: '停用',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!ok) return;
    }

    try {
      await setFirmwareReleaseActive(record.id, checked);
      message.success(checked ? '已启用' : '已停用');
      load();
    } catch (err) {
      message.error(err?.message || '操作失败');
    }
  }

  async function loadPreview({ board_type, firmware_version, channel }) {
    if (!board_type || !firmware_version) return;
    try {
      const res = await previewFirmwareOta({
        board_type,
        firmware_version,
        channel: channel || DEFAULT_CHANNEL,
      });
      setPreview(res.data);
    } catch (err) {
      setPreview({ error: err?.message || 'OTA 预览失败' });
    }
  }

  function renderPreview() {
    if (!preview) return null;
    if (preview.error) {
      return <Alert type="error" showIcon message={preview.error} style={{ marginTop: 16 }} />;
    }
    if (preview.update_available) {
      return (
        <Alert
          type="success"
          showIcon
          style={{ marginTop: 16 }}
          message={`OTA 预览：当前 ${preview.firmware_version} 的 ${preview.board_type} 设备会收到 ${preview.ota.version}`}
          description={preview.ota.force ? '该发布为强制升级，同版本设备也会收到 OTA。' : '仅低于目标版本的设备会收到 OTA。'}
        />
      );
    }
    const reasonText = {
      no_active_release: '没有匹配的启用发布',
      release_not_newer: '候选发布不高于当前版本',
      firmware_version_invalid: '当前版本格式无效',
      board_type_missing: '缺少板型',
    }[preview.reason] || preview.reason || '不会触发 OTA';
    return (
      <Alert
        type="warning"
        showIcon
        style={{ marginTop: 16 }}
        message={`OTA 预览：不会触发升级`}
        description={reasonText}
      />
    );
  }

  const columns = [
    {
      title: '板型',
      dataIndex: 'board_type',
      width: 150,
      render: (v) => <Tag>{v}</Tag>,
    },
    {
      title: '版本',
      key: 'version',
      width: 150,
      render: (_, record) => renderVersion(record),
    },
    {
      title: '渠道',
      dataIndex: 'channel',
      width: 100,
      render: (v) => <Tag color={v === DEFAULT_CHANNEL ? 'green' : 'default'}>{v}</Tag>,
    },
    {
      title: '固件地址',
      dataIndex: 'artifact_url',
      render: renderArtifactUrl,
    },
    {
      title: 'SHA256',
      dataIndex: 'sha256',
      width: 170,
      render: renderChecksum,
    },
    {
      title: '大小',
      dataIndex: 'size_bytes',
      width: 110,
      render: (v) => v == null ? '—' : `${Math.round(v / 1024)} KB`,
    },
    {
      title: 'OTA 结果',
      dataIndex: 'ota_summary',
      width: 210,
      render: renderOtaSummary,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 110,
      render: (v, record) => <Switch checked={v} size="small" onChange={(checked) => onToggle(record, checked)} />,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—',
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>固件发布</Typography.Title>
        <Space>
          <Input.Search
            placeholder="筛选板型"
            allowClear
            onSearch={(v) => { setFilters((f) => ({ ...f, boardType: v || undefined })); setPage(1); }}
            style={{ width: 180 }}
          />
          <Select
            placeholder="渠道"
            allowClear
            style={{ width: 120 }}
            options={[{ value: DEFAULT_CHANNEL, label: 'stable' }]}
            onChange={(v) => { setFilters((f) => ({ ...f, channel: v })); setPage(1); }}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建发布</Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        scroll={{ x: 1180 }}
        pagination={{ current: page, total, pageSize: 20, onChange: setPage, showTotal: (t) => `共 ${t} 条发布` }}
      />

      <Modal
        title="新建固件发布"
        open={modalOpen}
        onOk={createdRelease ? closeCreateModal : onSubmit}
        okText={createdRelease ? '完成' : '创建'}
        okButtonProps={{ loading: submitting, disabled: uploadingArtifact }}
        onCancel={closeCreateModal}
        width={680}
      >
        <Form form={form} layout="vertical" disabled={!!createdRelease} style={{ marginTop: 16 }}>
          <Form.Item label="固件文件">
            <Upload
              accept=".bin"
              maxCount={1}
              showUploadList={false}
              beforeUpload={onArtifactSelected}
            >
              <Button icon={<UploadOutlined />} loading={uploadingArtifact}>
                选择并上传 .bin
              </Button>
            </Upload>
          </Form.Item>
          <Form.Item name="board_type" label="目标板型" rules={[{ required: true, message: '请输入板型' }]}>
            <Input placeholder="例：esplink-v1" />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={15}>
              <Form.Item name="version" label="版本号" rules={[{ required: true, message: '请输入版本号' }]}>
                <Input placeholder="例：2.5.0" />
              </Form.Item>
            </Col>
            <Col xs={24} md={9}>
              <Form.Item name="channel" label="渠道" rules={[{ required: true, message: '请输入渠道' }]}>
                <Select options={[{ value: DEFAULT_CHANNEL, label: 'stable' }]} />
              </Form.Item>
            </Col>
          </Row>
          {duplicateRelease && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={`已存在 ${duplicateRelease.board_type} / ${duplicateRelease.version} / ${duplicateRelease.channel}`}
              description="同一板型、渠道和版本不能重复创建。需要重新发布时请先停用旧记录，并使用更高版本号或强制升级。"
            />
          )}
          <Form.Item name="artifact_url" label="固件地址" rules={[{ required: true, message: '请输入固件地址' }]}>
            <Input placeholder="上传固件后自动填入，也可手动输入 URL" />
          </Form.Item>
          <Form.Item name="sha256" label="SHA256" rules={[{ required: true, message: '请输入 SHA256' }]}>
            <Input placeholder="上传固件后自动填入" />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="size_bytes" label="文件大小（字节）">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="可选" />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="is_active" label="启用" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="force_update" label="强制升级" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="release_notes" label="发布说明">
            <Input.TextArea rows={3} placeholder="可选" />
          </Form.Item>
          {renderPreview()}
        </Form>
      </Modal>
    </div>
  );
}
