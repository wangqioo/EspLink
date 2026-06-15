import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Spin, Typography } from 'antd';
import { MobileOutlined, ApiOutlined, TeamOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { getUsageSummary, getDailyStats, getModelStats, getTopTenants } from '../../api';

const COLORS = ['#1677ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2'];

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [daily, setDaily] = useState([]);
  const [models, setModels] = useState([]);
  const [topTenants, setTopTenants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getUsageSummary(),
      getDailyStats({ days: 7 }),
      getModelStats({ days: 30 }),
      getTopTenants({ limit: 5 }),
    ]).then(([s, d, m, t]) => {
      setSummary(s.data);
      setDaily(d.data);
      setModels(m.data);
      setTopTenants(t.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />;

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 24 }}>运营概览</Typography.Title>

      <Row gutter={[16, 16]}>
        {[
          { title: '今日调用', value: summary?.today_calls, icon: <ThunderboltOutlined />, color: '#1677ff' },
          { title: '本月调用', value: summary?.month_calls, icon: <ApiOutlined />, color: '#52c41a' },
          { title: '在线设备', value: `${summary?.online_count} / ${summary?.total_devices}`, icon: <MobileOutlined />, color: '#faad14' },
          { title: '总租户数', value: summary?.tenant_count, icon: <TeamOutlined />, color: '#722ed1' },
        ].map((item) => (
          <Col xs={24} sm={12} lg={6} key={item.title}>
            <Card>
              <Statistic
                title={item.title}
                value={item.value}
                prefix={React.cloneElement(item.icon, { style: { color: item.color } })}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card title="近7天调用量趋势">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="calls" stroke="#1677ff" strokeWidth={2} dot={false} name="调用次数" />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="模型调用占比（近30天）">
            {models.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={models} dataKey="count" nameKey="model" cx="50%" cy="50%" outerRadius={80} label={({ model, percentage }) => `${model} ${percentage}%`}>
                    {models.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa' }}>暂无数据</div>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="本月调用量 Top5 租户">
            {topTenants.length === 0 ? (
              <div style={{ color: '#aaa', textAlign: 'center', padding: 24 }}>暂无数据</div>
            ) : (
              topTenants.map((t, i) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <span><strong>#{i + 1}</strong> {t.name}</span>
                  <span style={{ color: '#1677ff', fontWeight: 600 }}>{t.month_calls.toLocaleString()} 次</span>
                </div>
              ))
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
