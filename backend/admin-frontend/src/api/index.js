import axios from 'axios';
import { useAuthStore } from '../store';

const api = axios.create({ baseURL: '/api/v1', timeout: 15000 });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(err.response?.data || err);
  }
);

// Auth
export const login = (data) => api.post('/auth/login', data);
export const getMe = () => api.get('/auth/me');

// Tenants
export const getTenants = (params) => api.get('/tenants', { params });
export const getTenant = (id) => api.get(`/tenants/${id}`);
export const createTenant = (data) => api.post('/tenants', data);
export const updateTenant = (id, data) => api.patch(`/tenants/${id}`, data);
export const deleteTenant = (id) => api.delete(`/tenants/${id}`);

// API Keys
export const getKeys = (params) => api.get('/keys', { params });
export const getKey = (id) => api.get(`/keys/${id}`);
export const createKey = (data) => api.post('/keys', data);
export const updateKey = (id, data) => api.patch(`/keys/${id}`, data);
export const deleteKey = (id) => api.delete(`/keys/${id}`);
export const resetKeyUsage = (id) => api.post(`/keys/${id}/reset-usage`);

// Devices
export const getDevices = (params) => api.get('/devices', { params });
export const getDevice = (mac) => api.get(`/devices/${encodeURIComponent(mac)}`);
export const kickDevice = (mac) => api.post(`/devices/${encodeURIComponent(mac)}/kick`);
export const unbindDevice = (mac) => api.post(`/devices/${encodeURIComponent(mac)}/unbind`);
export const assignDeviceKey = (mac, api_key_id) => api.post(`/devices/${encodeURIComponent(mac)}/assign-key`, { api_key_id });

// Firmware releases
export const getFirmwareReleases = (params) => api.get('/firmware/releases', { params });
export const uploadFirmwareArtifact = (file) => api.post('/firmware/artifacts', file, {
  headers: {
    'Content-Type': 'application/octet-stream',
    'X-Firmware-Filename': encodeURIComponent(file.name),
  },
});
export const createFirmwareRelease = (data) => api.post('/firmware/releases', data);
export const setFirmwareReleaseActive = (id, is_active) => api.patch(`/firmware/releases/${id}/active`, { is_active });

// Usage
export const getUsageSummary = (params) => api.get('/usage/summary', { params });
export const getDailyStats = (params) => api.get('/usage/daily', { params });
export const getModelStats = (params) => api.get('/usage/by-model', { params });
export const getUsageLogs = (params) => api.get('/usage/logs', { params });

// Operation
export const getOperationOverview = () => api.get('/operation/overview');
export const getTopTenants = (params) => api.get('/operation/top-tenants', { params });

// LLM 模型配置
export const getLlmProviders = () => api.get('/llm/providers');
export const getLlmModels = () => api.get('/llm/models');
export const upsertLlmProvider = (provider, data) => api.put(`/llm/providers/${provider}`, data);
export const toggleLlmProvider = (provider) => api.patch(`/llm/providers/${provider}/toggle`);

export default api;
