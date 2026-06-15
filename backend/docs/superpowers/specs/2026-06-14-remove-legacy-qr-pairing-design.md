# Remove Legacy QR Pairing

## Purpose

Remove the unused QR-code pairing flow so Device association has one supported path: EspLink registration, discovery, and WeChat binding.

## Scope

- Remove the `/api/v1/pair/verify`, `/api/v1/pair/confirm`, and `/api/v1/pair/status/:deviceId` routes.
- Remove the `PairRecord` Prisma model and the `Tenant.pair_records` relation.
- Remove `registerDevice()` logic that reads and updates `pair_records`.
- Remove documentation that describes QR-code pairing as supported.
- Keep the current EspLink routes and WebSocket protocol unchanged.

## Device Association After Removal

1. Firmware calls `POST /api/ota/check`.
2. The backend creates or refreshes the Device and returns its device key.
3. The Device connects to `/ws/device`.
4. The mini-program discovers the recently online Device by MAC suffix.
5. The mini-program calls `POST /api/device/bind`.
6. Binding sets `wechat_user_id`, `is_paired`, and `paired_at`.

The management route `POST /api/v1/devices/register` remains available, but registration alone no longer infers pairing or tenant assignment from a `device_id`.

## Data Impact

The code and Prisma schema removal do not alter the database immediately. The next `prisma db push` will propose dropping the `pair_records` table and its historical data.

Database synchronization must be run only after the backend process is stopped, as required by the repository instructions.

## Compatibility

- Preserve `/api/` for EspLink-compatible routes.
- Preserve `/api/v1/` for management routes.
- Preserve `/api/ota/check`, `/api/device/*`, and `/ws/device`.
- Preserve the `Device.device_id` field because management registration and existing records may still use it as device metadata.
- Do not change Express, HTTP server, WebSocket buffering, MAC formatting, or authentication behavior.

## Error Behavior

Requests to removed `/api/v1/pair/*` paths will fall through to the existing not-found behavior. No compatibility response or deprecation period will be added because the flow has no known caller.

## Testing

- Add a focused test proving `registerDevice()` creates a Device without accessing `prisma.pairRecord`.
- Verify the management router no longer mounts `/pair`.
- Verify no production source references `PairRecord`, `pairRecord`, or `pair_records`.
- Run the complete Jest suite.
- Run `prisma validate` against the updated schema without pushing database changes.

## Documentation

Update `README.md`, `CLAUDE.md`, `AGENTS.md`, and `open.md` so they describe only the EspLink association flow and the reduced table/model count.

## Acceptance Criteria

- No `/api/v1/pair/*` route is mounted.
- `src/routes/pair.js` is deleted.
- `PairRecord` is absent from the Prisma schema.
- Device registration does not query pairing records.
- EspLink registration, discovery, binding, and WebSocket paths remain unchanged.
- Tests and Prisma schema validation pass.
