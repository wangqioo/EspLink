import React, { useEffect, useState, useCallback } from 'react';
import { Row, Col, Card, Table, Select, Button, Space, Typography, Statistic, Tag } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { getUsageSummary, getDailyStats, getModelStats, getUsageLogs, getTenants } from '../../api';
import dayjs from 'dayjs';

const COLORS = ['#1677ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2'];

function downloadCSV(logs) {
  const header = ['时间', 'API Key', '设备MAC', '模型', '输入Token', '输出Token', '延迟(ms)', '成功'];
  const rows = logs.map((l) => [
    dayjs(l.timestamp).format('YYYY-MM-DD HH:mm:ss'),
    l.api_key_id || '', l.device_mac || '', l.model || '',
    l.input_tokens, l.output_tokens, l.latency_ms || '',
    l.success ? '是' : '否',
  ]);
  const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `usage_${dayjs().format('YYYYMMDD')}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export default function Usage() {
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState(undefined);
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState(null);
  const [daily, setDaily] = useState([]);
  const [models, setModels] = useState([]);
  const [logs, setLogs] = useState([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getTenants({ pageSize: 100 }).then((res) => setTenants(res.data.list));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d, m, l] = await Promise.all([
        getUsageSummary({ tenantId }),
        getDailyStats({ tenantId, days }),
        getModelStats({ tenantId, days: 30 }),
        getUsageLogs({ tenantId, page: logPage, pageSize: 50 }),
      ]);
      setSummary(s.data);
      setDaily(d.data);
      setModels(m.data);
      setLogs(l.data.list);
      setLogTotal(l.data.pagination.total);
    } finally {
      setLoading(false);
    }
  }, [tenantId, days, logPage]);

  useEffect(() => { load(); }, [load]);

  const logColumns = [
    { title: '时间', dataIndex: 'timestamp', width: 170, render: (v) => dayjs(v).format('MM-DD HH:mm:ss') },
    { title: 'API Key', dataIndex: 'api_key_id', ellipsis: true, width: 180, render: (v, r) => r.api_key?.name || (v ? `${v.slice(0, 16)}…` : '—') },
    { title: '设备MAC', dataIndex: 'device_mac', render: (v) => v ? <code style={{ fontSize: 11 }}>{v}</code> : '—' },
    { title: '模型', dataIndex: 'model', render: (v) => v ? <Tag>{v}</Tag> : '—' },
    { title: '输入Token', dataIndex: 'input_tokens', align: 'right' },
    { title: '输出Token', dataIndex: 'output_tokens', align: 'right' },
    { title: '延迟(ms)', dataIndex: 'latency_ms', align: 'right', render: (v) => v ?? '—' },
    { title: '状态', dataIndex: 'success', render: (v) => <Tag color={v ? 'success' : 'error'}>{v ? '成功' : '失败'}</Tag> },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>用量统计</Typography.Title>
        <Space>
          <Select
            placeholder="筛选租户"
            allowClear
            style={{ width: 160 }}
            options={tenants.map((t) => ({ value: t.id, label: t.name }))}
            onChange={(v) => { setTenantId(v); setLogPage(1); }}
          />
          <Select
            value={days}
            style={{ width: 100 }}
            options={[{ value: 7, label: '近7天' }, { value: 14, label: '近14天' }, { value: 30, label: '近30天' }]}
            onChange={setDays}
          />
        </Space>
      </div>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]}>
        {[
          { title: '今日调用', value: summary?.today_calls },
          { title: '本月调用', value: summary?.month_calls },
          { title: '总调用次数', value: summary?.total_calls },
          { title: '在线/全部设备', value: `${summary?.online_count ?? 0} / ${summary?.total_devices ?? 0}` },
        ].map((item) => (
          <Col xs={12} sm={6} key={item.title}>
            <Card><Statistic title={item.title} value={item.value} /></Card>
          </Col>
        ))}
      </Row>

      {/* 图表 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card title={`近 ${days} 天调用量趋势`} loading={loading}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="calls" stroke="#1677ff" strokeWidth={2} dot={false} name="调用次数" />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="模型占比（近30天）" loading={loading}>
            {models.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={models} dataKey="count" nameKey="model" cx="50%" cy="50%" outerRadius={75}>
                    {models.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Legend formatter={(v) => <span style={{ fontSize: 12 }}>{v}</span>} />
                  <Tooltip formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa' }}>暂无数据</div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 明细日志 */}
      <Card
        style={{ marginTop: 16 }}
        title="调用明细（最近7天）"
        extra={
          <Button icon={<DownloadOutlined />} size="small" onClick={() => downloadCSV(logs)}>
            导出 CSV
          </Button>
        }
      >
        <Table
          rowKey="id"
          size="small"
          columns={logColumns}
          dataSource={logs}
          loading={loading}
          pagination={{
            current: logPage,
            total: logTotal,
            pageSize: 50,
            onChange: setLogPage,
            showTotal: (t) => `共 ${t} 条记录`,
          }}
          scroll={{ x: 900 }}
        />
      </Card>
    </div>
  );
}
