# Device Presence Design

## Goal

Create a small `DevicePresence` module that owns the backend definition of device online state for the current single-instance deployment.

## Scope

This phase centralizes existing behavior without changing the database schema or introducing Redis presence. WebSocket connect, heartbeat, disconnect, and stale-expiry paths should all use the same module.

## Interface

`src/services/devicePresence.js` exposes:

- `markConnected(mac)` sets `last_seen = NOW()` and `is_online = true`.
- `markHeartbeat(mac)` sets `last_seen = NOW()` and `is_online = true`.
- `markDisconnected(mac)` sets `is_online = false`.
- `expireStale({ staleMinutes })` marks online devices as offline when `last_seen` is older than the configured MySQL-side interval.

## Data Flow

`deviceWsManager` authenticates the device, stores the WebSocket connection in memory, then calls `markConnected`. `hello` and `ping` call `markHeartbeat`. `close` calls `markDisconnected` only when the closing socket is still the active socket for that MAC. `heartbeatChecker` delegates stale expiry to `expireStale`.

## Error Handling

This phase preserves the current WebSocket behavior: presence write failures are swallowed in WS paths so device connections are not dropped for transient database errors. The scheduled heartbeat checker logs expiry errors.

## Testing

Unit tests cover each `DevicePresence` interface using mocked Prisma calls. Existing rate-limit tests are updated to mock `DevicePresence` instead of `dbTime.touchDevice`. The full Jest suite must pass.
