# Device Capability And Admin Read Model Design

## Goal

Add a safe capability interpretation module and prepare admin-facing device status fields without changing the database schema.

## Scope

This phase keeps `devices.capabilities` as text JSON. The backend should stop letting malformed capability blobs crash read paths, and the admin UI should be ready to display board type, capability summary, and clearer online state.

## Modules

### DeviceCapability

`src/services/deviceCapability.js` owns parsing and summarizing capability blobs.

- `parseStoredCapabilities(deviceOrString)` safely parses stored text JSON.
- `normalizeHelloCapabilities(input, context)` normalizes firmware `hello` capability payloads and stamps a schema version.
- `toClientCapabilitySummary(device)` returns a compact, UI-safe summary.

### DeviceAdminReadModel

`src/services/deviceAdminReadModel.js` maps device rows into admin rows.

- `buildDeviceAdminRow(device, { wsConnected })` derives `db_online`, `ws_connected`, `seconds_since_seen`, `admin_status`, and `capabilities_summary`.
- `buildDeviceAdminList(devices, { isConnected })` maps lists using the WebSocket connection checker.

## Data Flow

WebSocket `hello` can later route raw capability input through `DeviceCapability.normalizeHelloCapabilities`. WeChat device list and admin read paths consume `parseStoredCapabilities` and `toClientCapabilitySummary`. Admin UI remains backward compatible with old `is_online` and raw `capabilities` fields.

## Testing

Unit tests cover safe parsing, malformed stored JSON, summary generation, admin online status derivation, and WeChat list compatibility. Frontend validation uses the existing Vite build.
