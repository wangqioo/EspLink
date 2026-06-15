import React, { useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, theme } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  DashboardOutlined, TeamOutlined, KeyOutlined, MobileOutlined,
  BarChartOutlined, LogoutOutlined, UserOutlined, RobotOutlined,
  ApiOutlined, CloudUploadOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../store';

const { Sider, Header, Content } = Layout;

const navItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: '/tenants', icon: <TeamOutlined />, label: '租户管理' },
  { key: '/keys', icon: <KeyOutlined />, label: 'API Key' },
  { key: '/devices', icon: <MobileOutlined />, label: '设备管理' },
  { key: '/firmware', icon: <CloudUploadOutlined />, label: '固件发布' },
  { key: '/usage', icon: <BarChartOutlined />, label: '用量统计' },
  { key: '/llm-config', icon: <ApiOutlined />, label: '模型配置' },
];

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { username, logout } = useAuthStore();
  const { token: { colorBgContainer } } = theme.useToken();

  const userMenu = {
    items: [{ key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true }],
    onClick: ({ key }) => key === 'logout' && (logout(), navigate('/login')),
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark">
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <RobotOutlined style={{ color: '#1677ff', fontSize: 22 }} />
          {!collapsed && <span style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>小氧AI管理</span>}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={navItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>

      <Layout>
        <Header style={{ background: colorBgContainer, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', borderBottom: '1px solid #f0f0f0' }}>
          <Dropdown menu={userMenu} placement="bottomRight">
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar icon={<UserOutlined />} size="small" />
              <span>{username}</span>
            </div>
          </Dropdown>
        </Header>

        <Content style={{ margin: 24, minHeight: 280 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
