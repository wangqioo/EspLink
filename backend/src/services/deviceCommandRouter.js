const defaultTransport = require('../ws/deviceWsManager');
const defaultPresence = require('./devicePresenceProjection');
const defaultBroker = require('./deviceCommandBroker');

async function send(mac, payload, {
  transport = defaultTransport,
  presence = defaultPresence,
  broker = defaultBroker,
  instanceId = process.env.INSTANCE_ID || `${process.pid}`,
} = {}) {
  try {
    const delivered = transport.sendCommand(mac, payload);
    if (delivered) {
      return { delivered: true, status: 'delivered' };
    }

    const projected = await presence.get(mac);
    if (projected.online && projected.instanceId && projected.instanceId !== instanceId) {
      try {
        const publishResult = await broker.publish(projected.instanceId, { mac, payload });
        if (publishResult.published) {
          return {
            delivered: false,
            status: 'published',
            reason: 'remote_instance',
            instanceId: projected.instanceId,
          };
        }
      } catch (error) {
        return {
          delivered: false,
          status: 'failed',
          reason: 'broker_error',
          error,
        };
      }
    }

    return {
      delivered: false,
      status: 'offline',
      reason: 'device_offline',
    };
  } catch (error) {
    return {
      delivered: false,
      status: 'failed',
      reason: 'transport_error',
      error,
    };
  }
}

module.exports = { send };
