const redis = require('../config/redis');

function channelFor(instanceId) {
  return `device:commands:${instanceId}`;
}

async function publish(instanceId, { mac, payload }) {
  const subscribers = await redis.publish(
    channelFor(instanceId),
    JSON.stringify({ mac, payload })
  );
  return { published: subscribers > 0, subscribers };
}

function subscribe(instanceId, handler, { redisClient = redis } = {}) {
  const channel = channelFor(instanceId);
  const subscriber = redisClient.duplicate();

  subscriber.on('message', (messageChannel, raw) => {
    if (messageChannel !== channel) return;
    try {
      const message = JSON.parse(raw);
      handler(message);
    } catch {}
  });

  subscriber.subscribe(channel, (err) => {
    if (err) console.error('[DeviceCommandBroker] subscribe error:', err.message);
  });

  return { channel, subscriber };
}

module.exports = { channelFor, publish, subscribe };
