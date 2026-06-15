import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store';
import AppLayout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Tenants from './pages/Tenants';
import ApiKeys from './pages/ApiKeys';
import Devices from './pages/Devices';
import Firmware from './pages/Firmware';
import Usage from './pages/Usage';
import LlmConfig from './pages/LlmConfig';

function RequireAuth({ children }) {
  const token = useAuthStore((s) => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="tenants" element={<Tenants />} />
          <Route path="keys" element={<ApiKeys />} />
          <Route path="devices" element={<Devices />} />
          <Route path="firmware" element={<Firmware />} />
          <Route path="usage" element={<Usage />} />
          <Route path="llm-config" element={<LlmConfig />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
