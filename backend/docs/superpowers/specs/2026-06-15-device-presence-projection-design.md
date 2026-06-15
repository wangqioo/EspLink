# Device Presence Projection Design

## Goal

Add a Redis TTL projection of active device WebSocket ownership without replacing the existing database online state.

## Scope

This phase writes global presence hints to Redis from WebSocket connect, heartbeat, and close paths. It does not change admin status semantics, command routing, `devices.is_online`, or heartbeat expiry behavior.

## Module

`src/services/devicePresenceProjection.js` owns Redis projection behavior.

- `register(mac, { ownerId, instanceId, ttlSeconds })`
- `heartbeat(mac, { ownerId, ttlSeconds })`
- `disconnect(mac, { ownerId })`
- `get(mac)`
- `isOnline(mac)`

Redis keys use `device:presence:{mac}`. Values include `owner_id`, `instance_id`, `connected_at`, and `last_seen_at`. Heartbeat and disconnect use owner-guarded Lua scripts so an old socket cannot refresh or delete a newer connection owner.

## WebSocket Integration

Each authenticated socket gets an `ownerId` shaped as `instanceId:timestamp:sequence`. The WebSocket manager writes:

- `register` after DB `markConnected`
- `heartbeat` after DB `markHeartbeat`
- `disconnect` after DB `markDisconnected`, only when the closing socket is still the active local socket

Projection failures are swallowed in this phase, matching the existing WebSocket presence behavior.

## Non-Goals

- Do not use Redis projection for command routing yet.
- Do not replace `db_online` or `ws_connected`.
- Do not remove DB heartbeat expiry.
- Do not add Redis pub/sub or streams.

## Testing

Unit tests cover Redis projection owner guards and Redis outage behavior. WebSocket tests cover owner propagation and the existing replaced-socket close guard.
