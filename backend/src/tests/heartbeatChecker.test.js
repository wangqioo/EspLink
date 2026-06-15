jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

jest.mock('../services/devicePresence', () => ({
  expireStale: jest.fn(() => Promise.resolve(0)),
}));

jest.mock('../config/database', () => ({
  $executeRaw: jest.fn(() => Promise.resolve(0)),
}));

const cron = require('node-cron');
const devicePresence = require('../services/devicePresence');

describe('heartbeatChecker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('expires stale online devices through DevicePresence every minute', async () => {
    const { start } = require('../jobs/heartbeatChecker');

    start();
    const scheduledHandler = cron.schedule.mock.calls[0][1];
    await scheduledHandler();

    expect(cron.schedule).toHaveBeenCalledWith('* * * * *', expect.any(Function));
    expect(devicePresence.expireStale).toHaveBeenCalledWith({ staleMinutes: 2 });
  });
});
