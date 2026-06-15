const defaultRedisClient = require('../config/redis');

function leaseKey(jobName) {
  return `jobCoordinator:${jobName}`;
}

function leaseToken() {
  return `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

async function runWithLease(jobName, ttlMs, fn, { redisClient = defaultRedisClient } = {}) {
  let acquired;

  try {
    acquired = await redisClient.set(leaseKey(jobName), leaseToken(), 'NX', 'PX', ttlMs);
  } catch (err) {
    const result = await fn();
    return { acquired: null, failOpen: true, result };
  }

  if (acquired !== 'OK') {
    return { acquired: false, result: null };
  }

  const result = await fn();
  return { acquired: true, result };
}

module.exports = { runWithLease };
