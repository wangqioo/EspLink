const redis = require('../config/redis');

const DEFAULT_TTL_SECONDS = 120;

const HEARTBEAT_IF_OWNER_SCRIPT = `
  local raw = redis.call('GET', KEYS[1])
  if not raw then return 0 end
  local data = cjson.decode(raw)
  if data["owner_id"] ~= ARGV[1] then return 0 end
  data["last_seen_at"] = ARGV[2]
  redis.call('SET', KEYS[1], cjson.encode(data), 'EX', tonumber(ARGV[3]))
  return 1
`;

const DELETE_IF_OWNER_SCRIPT = `
  local raw = redis.call('GET', KEYS[1])
  if not raw then return 0 end
  local data = cjson.decode(raw)
  if data["owner_id"] ~= ARGV[1] then return 0 end
  redis.call('DEL', KEYS[1])
  return 1
`;

function presenceKey(mac) {
  return `device:presence:${mac}`;
}

function nowIso() {
  return new Date().toISOString();
}

function buildValue({ ownerId, instanceId, connectedAt, lastSeenAt }) {
  return {
    owner_id: ownerId,
    instance_id: instanceId || ownerId?.split(':')[0] || null,
    connected_at: connectedAt || nowIso(),
    last_seen_at: lastSeenAt || nowIso(),
  };
}

async function register(mac, { ownerId, instanceId, ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  try {
    const at = nowIso();
    await redis.set(
      presenceKey(mac),
      JSON.stringify(buildValue({ ownerId, instanceId, connectedAt: at, lastSeenAt: at })),
      'EX',
      ttlSeconds
    );
    return { projected: true };
  } catch (error) {
    return { projected: false, error };
  }
}

async function heartbeat(mac, { ownerId, ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  try {
    const matched = await redis.eval(
      HEARTBEAT_IF_OWNER_SCRIPT,
      1,
      presenceKey(mac),
      ownerId,
      nowIso(),
      ttlSeconds
    );
    return { projected: matched !== 0, ownerMatched: matched !== 0 };
  } catch (error) {
    return { projected: false, ownerMatched: null, error };
  }
}

async function disconnect(mac, { ownerId } = {}) {
  try {
    const matched = await redis.eval(
      DELETE_IF_OWNER_SCRIPT,
      1,
      presenceKey(mac),
      ownerId
    );
    return { projected: matched !== 0, ownerMatched: matched !== 0 };
  } catch (error) {
    return { projected: false, ownerMatched: null, error };
  }
}

async function get(mac) {
  try {
    const raw = await redis.get(presenceKey(mac));
    if (!raw) return { online: false };
    const data = JSON.parse(raw);
    const ttlSeconds = await redis.ttl(presenceKey(mac));
    return {
      online: true,
      ownerId: data.owner_id,
      instanceId: data.instance_id,
      connectedAt: data.connected_at,
      lastSeenAt: data.last_seen_at,
      ttlSeconds,
    };
  } catch (error) {
    return { online: null, error };
  }
}

async function isOnline(mac) {
  const presence = await get(mac);
  return presence.online;
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  register,
  heartbeat,
  disconnect,
  get,
  isOnline,
};
