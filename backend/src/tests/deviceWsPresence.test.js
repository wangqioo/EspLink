const serverInstances = [];

jest.mock('ws', () => ({
  WebSocketServer: jest.fn(function WebSocketServer() {
    this.handlers = {};
    this.on = jest.fn((event, handler) => {
      this.handlers[event] = handler;
    });
    serverInstances.push(this);
  }),
}));

jest.mock('../config/redis', () => ({
  eval: jest.fn(),
}));

jest.mock('../config/database', () => ({
  device: {
    findFirst: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
}));

jest.mock('../services/devicePresence', () => ({
  markConnected: jest.fn(() => Promise.resolve()),
  markHeartbeat: jest.fn(() => Promise.resolve()),
  markDisconnected: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/devicePresenceProjection', () => ({
  register: jest.fn(() => Promise.resolve()),
  heartbeat: jest.fn(() => Promise.resolve()),
  disconnect: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/deviceCommandBroker', () => ({
  subscribe: jest.fn(),
}));

jest.mock('../services/llmService', () => ({
  getModelForDevice: jest.fn(),
  streamChat: jest.fn(),
}));

const prisma = require('../config/database');
const devicePresence = require('../services/devicePresence');
const devicePresenceProjection = require('../services/devicePresenceProjection');
const deviceCommandBroker = require('../services/deviceCommandBroker');

function createFakeSocket() {
  const handlers = {};
  return {
    readyState: 1,
    on: jest.fn((event, handler) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
    }),
    off: jest.fn((event, handler) => {
      handlers[event] = (handlers[event] || []).filter((item) => item !== handler);
    }),
    emit: jest.fn((event, ...args) => {
      for (const handler of handlers[event] || []) handler(...args);
    }),
    emitMessage: async function emitMessage(raw) {
      for (const handler of handlers.message || []) await handler(raw);
    },
    emitClose: async function emitClose() {
      for (const handler of handlers.close || []) await handler();
    },
    close: jest.fn(),
    send: jest.fn(),
  };
}

describe('device WS presence integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serverInstances.length = 0;
    prisma.device.findFirst.mockResolvedValue({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      device_key: 'device-token',
    });
    deviceCommandBroker.subscribe.mockReturnValue({ channel: 'device:commands:test' });
  });

  test('does not mark device offline when a replaced socket closes after a newer connection exists', async () => {
    const { setup } = require('../ws/deviceWsManager');
    const wss = setup({});
    const req = { headers: { authorization: 'Bearer device-token' } };
    const firstSocket = createFakeSocket();
    const secondSocket = createFakeSocket();

    await wss.handlers.connection(firstSocket, req);
    await wss.handlers.connection(secondSocket, req);
    devicePresence.markDisconnected.mockClear();

    await firstSocket.emitClose();

    expect(firstSocket.close).toHaveBeenCalledWith(4000, 'replaced');
    expect(devicePresence.markDisconnected).not.toHaveBeenCalled();
    expect(devicePresenceProjection.disconnect).not.toHaveBeenCalled();

    await secondSocket.emitClose();

    expect(devicePresence.markDisconnected).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
    expect(devicePresenceProjection.disconnect).toHaveBeenCalledWith(
      'AA:BB:CC:DD:EE:FF',
      { ownerId: expect.stringContaining(':') }
    );
  });

  test('projects connect and heartbeat with the active connection owner id', async () => {
    const { setup } = require('../ws/deviceWsManager');
    const wss = setup({});
    const req = { headers: { authorization: 'Bearer device-token' } };
    const socket = createFakeSocket();

    await wss.handlers.connection(socket, req);
    const registerOwnerId = devicePresenceProjection.register.mock.calls[0][1].ownerId;
    await socket.emitMessage(Buffer.from(JSON.stringify({ type: 'ping' })));

    expect(devicePresenceProjection.register).toHaveBeenCalledWith(
      'AA:BB:CC:DD:EE:FF',
      expect.objectContaining({
        ownerId: registerOwnerId,
        instanceId: expect.any(String),
      })
    );
    expect(devicePresenceProjection.heartbeat).toHaveBeenCalledWith(
      'AA:BB:CC:DD:EE:FF',
      { ownerId: registerOwnerId }
    );
  });

  test('normalizes firmware version reported by hello before storing it', async () => {
    prisma.device.findUnique.mockResolvedValue({ wechat_user_id: null });
    const { setup } = require('../ws/deviceWsManager');
    const wss = setup({});
    const req = { headers: { authorization: 'Bearer device-token' } };
    const socket = createFakeSocket();

    await wss.handlers.connection(socket, req);
    await socket.emitMessage(Buffer.from(JSON.stringify({
      type: 'hello',
      firmware_version: 'v02.004.001',
    })));

    expect(prisma.device.update).toHaveBeenCalledWith({
      where: { mac_address: 'AA:BB:CC:DD:EE:FF' },
      data: { firmware: '2.4.1' },
    });
  });

  test('does not update stored firmware when hello reports a malformed version', async () => {
    prisma.device.findUnique.mockResolvedValue({ wechat_user_id: null });
    const { setup } = require('../ws/deviceWsManager');
    const wss = setup({});
    const req = { headers: { authorization: 'Bearer device-token' } };
    const socket = createFakeSocket();

    await wss.handlers.connection(socket, req);
    await socket.emitMessage(Buffer.from(JSON.stringify({
      type: 'hello',
      firmware_version: 'latest',
    })));

    expect(prisma.device.update).not.toHaveBeenCalled();
  });

  test('subscribes to instance command channel and forwards broker messages to local socket', async () => {
    const { setup } = require('../ws/deviceWsManager');
    const wss = setup({});
    const req = { headers: { authorization: 'Bearer device-token' } };
    const socket = createFakeSocket();

    await wss.handlers.connection(socket, req);
    const handler = deviceCommandBroker.subscribe.mock.calls[0][1];
    handler({
      mac: 'AA:BB:CC:DD:EE:FF',
      payload: { command: 'reboot' },
    });

    expect(deviceCommandBroker.subscribe).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'command',
      payload: { command: 'reboot' },
    }));
  });
});
