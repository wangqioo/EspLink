import React, { useEffect } from 'react';
import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined, RobotOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { login } from '../../api';
import { useAuthStore } from '../../store';

export default function Login() {
  const navigate = useNavigate();
  const { setAuth, token } = useAuthStore();
  const [form] = Form.useForm();
  const [loading, setLoading] = React.useState(false);

  useEffect(() => {
    if (token) navigate('/dashboard', { replace: true });
  }, [token, navigate]);

  async function onFinish({ username, password }) {
    setLoading(true);
    try {
      const res = await login({ username, password });
      setAuth(res.data.token, res.data.username);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      message.error(err?.message || '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
      <Card style={{ width: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <RobotOutlined style={{ fontSize: 48, color: '#1677ff' }} />
          <h2 style={{ marginTop: 12, marginBottom: 4 }}>小氧AI 后台管理</h2>
          <p style={{ color: '#888', fontSize: 13 }}>请使用管理员账号登录</p>
        </div>
        <Form form={form} onFinish={onFinish} layout="vertical" size="large">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>登录</Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
