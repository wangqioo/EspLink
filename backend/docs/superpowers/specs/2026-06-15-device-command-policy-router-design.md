# Device Command Policy And Router Design

## Goal

Put command authorization, capability checks, and delivery result semantics behind explicit modules before adding multi-instance routing.

## Scope

This phase keeps WebSocket delivery local to the current Node process. It does not add Redis pub/sub or command acknowledgement persistence. It adds a policy seam and a router seam so the HTTP route no longer sends arbitrary payloads directly to a socket.

## Modules

### DeviceCommandPolicy

`src/services/deviceCommandPolicy.js` owns command eligibility.

- Normalize the command name from `payload.command` or `payload.type`.
- Check actor ownership for WeChat users.
- Reject unknown commands.
- Respect `device.capabilities.commands` when present.
- Return structured decisions with `allowed`, `command`, `reason`, and `statusCode`.

### DeviceCommandRouter

`src/services/deviceCommandRouter.js` owns delivery result shaping.

- Wrap the current `deviceWsManager.sendCommand(mac, payload)`.
- Return `delivered`, `offline`, or `failed` results instead of raw booleans.
- Accept an injected transport in tests.

## Route Flow

`POST /api/device/:mac/command` loads the target device, asks `DeviceCommandPolicy` whether the WeChat actor may send the payload, then asks `DeviceCommandRouter` to deliver it. Policy errors map to 4xx responses. Offline delivery maps to `503`. Successful local delivery returns `{ ok: true, status: 'delivered' }`.

## Testing

Unit tests cover policy decisions and router result shaping. Route tests cover ownership rejection, unsupported commands, offline devices, and successful delivery using mocked auth, Prisma, policy, and router dependencies.
