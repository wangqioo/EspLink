# Cross-Instance Command Routing Design

## Goal

Allow an HTTP request handled by one backend instance to route a device command to another backend instance that owns the device WebSocket.

## Scope

This phase adds Redis pub/sub delivery between backend instances. It does not add persistent command storage, device acknowledgement, retries, or delivery receipts. A remote result means the command was published to the owning backend instance, not that the device executed it.

## Modules

### DeviceCommandBroker

`src/services/deviceCommandBroker.js` owns Redis command channels.

- `publish(instanceId, { mac, payload })`
- `subscribe(instanceId, handler)`
- Channel format: `device:commands:{instanceId}`

The subscriber receives JSON messages and calls the local WebSocket transport.

### DeviceCommandRouter

`DeviceCommandRouter.send(mac, payload)` keeps the local-first path:

1. Try local `transport.sendCommand(mac, payload)`.
2. If delivered locally, return `delivered`.
3. If not local, ask `DevicePresenceProjection.get(mac)`.
4. If Redis presence is offline/unknown/missing owner, return offline.
5. If Redis presence points to a remote instance, publish through `DeviceCommandBroker` and return `published`.

## WebSocket Integration

`deviceWsManager.setup()` starts a command subscription for the current `INSTANCE_ID`. Messages received on that channel call local `sendCommand(mac, payload)`.

## Non-Goals

- Do not wait for device ACK.
- Do not retry failed pub/sub publishes.
- Do not persist commands.
- Do not treat Redis presence as a replacement for DB online state.

## Testing

Unit tests cover broker publish/subscribe, router local delivery, router remote publish, Redis unknown/offline behavior, and WebSocket subscription dispatch into local command delivery.
