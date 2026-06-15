const redis = require('../config/redis');

const RATE_LIMIT_SCRIPT = `
  local key = KEYS[1]
  local limit = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local current = tonumber(redis.call('GET', key) or 0)
  if current >= limit then return 0 end
  redis.call('INCR', key)
  if current == 0 then redis.call('EXPIRE', key, window) end
  return 1
`;

async function consume(subject, {
  limit,
  windowSeconds,
  keyPrefix = 'ratelimit',
  failOpen = true,
} = {}) {
  const result = await redis.eval(
    RATE_LIMIT_SCRIPT,
    1,
    `${keyPrefix}:${subject}`,
    limit,
    windowSeconds
  ).catch(() => (failOpen ? 1 : 0));

  return result !== 0;
}

module.exports = { consume };
