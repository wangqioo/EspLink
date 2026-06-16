# Production Readiness Foundation Design

## Context

EspLink currently has a verified local integration path across the Node backend,
admin frontend, ESP32-S3 firmware, and WeChat mini program. The device can boot,
register with `/api/ota/check`, connect to `/ws/device`, receive OTA metadata,
download a firmware image, reboot, and come back online on the new version.

The remaining gap is production readiness. The backend already contains several
production-side modules, including device PSK verification and firmware release
selection, but the firmware still uses unsigned boot registration and only logs
OTA SHA256 metadata. The repository also still documents a local workflow that
borrows environment variables from the old backend checkout.

## Goal

Build the first production readiness foundation for EspLink:

- devices can prove their identity during boot registration when production PSK
  enforcement is enabled;
- firmware refuses OTA images whose SHA256 does not match the backend release
  metadata;
- local development can continue over HTTP, while production configuration is
  explicit about HTTPS/WSS and certificate verification;
- the current repository owns its own environment and deployment documentation;
- hardware regression scenarios are documented as a repeatable checklist.

## Non-Goals

This phase will not add new mini program product features, multi-product dynamic
pages, QR-code provisioning, AI conversation improvements, or a complete factory
provisioning backend. It may add the firmware-side PSK inputs needed to test a
pre-provisioned production key, but large-scale key manufacturing remains out of
scope.

## Architecture

### Firmware Boot Identity

The firmware boot registration body will include:

```json
{
  "mac": "AA:BB:CC:DD:EE:FF",
  "sn": "SN001",
  "board_type": "esplink-v1",
  "firmware_version": "1.0.3",
  "timestamp": 1781539200,
  "nonce": "boot-<random>",
  "signature": "<hmac-sha256>"
}
```

The signature payload must match the backend `deviceIdentityService` canonical
payload:

```text
mac + "\n" + sn + "\n" + timestamp + "\n" + nonce
```

The signing key will come from firmware configuration. Development builds keep
the key unset and continue to work while `REQUIRE_DEVICE_PSK` is not `true`.
Production validation enables both a configured firmware PSK and backend
`REQUIRE_DEVICE_PSK=true`.

### OTA Integrity

The existing `app_ota_update_t` metadata already carries `sha256` and
`size_bytes`. `app_ota_upgrade` will become responsible for enforcing metadata
before accepting an upgrade:

- reject malformed SHA256 strings when provided;
- download and install with ESP-IDF OTA APIs;
- verify the resulting OTA partition SHA256 before reboot;
- abort the upgrade if the expected SHA256 does not match.

Local HTTP OTA remains available for bench validation. Production docs must make
HTTPS OTA and certificate verification the required deployment shape.

### Transport Configuration

Configuration should make the development and production modes explicit:

- development: HTTP `/api/ota/check`, WS `/ws/device`, optional unsigned boot
  registration;
- production: HTTPS `/api/ota/check`, WSS `/ws/device`, PSK-signed boot
  registration, certificate verification, SHA256-enforced OTA.

The implementation should avoid hardcoding the current Mac LAN IP as the only
documented path.

### Repository-Local Environment

The backend should have a repository-owned `.env.example` that covers:

- server port and public base URLs;
- database and Redis settings;
- admin authentication secrets;
- WeChat mini program credentials;
- firmware upload storage;
- device PSK enforcement;
- WebSocket and OTA public URLs.

The local run documentation should stop depending on
`/Users/wq/ai_deploy_backend/.env` as the normal path.

### Hardware Regression Checklist

Add a runbook covering:

- unsigned development registration still works when PSK is disabled;
- signed production registration succeeds when PSK is enabled;
- missing, stale, replayed, and invalid signatures fail;
- normal OTA succeeds;
- forced OTA succeeds;
- wrong SHA256 is rejected;
- wrong board type or version does not upgrade;
- interrupted download does not brick the device;
- backend restart and WiFi reconnect restore WebSocket presence.

## Components

### Firmware

- `main/main.c`: constructs signed boot registration body and keeps state
  transitions unchanged.
- `main/app_device.*`: exposes stable identity values already used by boot
  registration.
- `main/app_ota.*`: enforces OTA metadata and SHA256 verification.
- `main/Kconfig.projbuild`: adds explicit development/production knobs for PSK
  and transport validation where needed.
- `sdkconfig.defaults`: keeps defaults safe for source control.

### Backend

- `src/services/deviceIdentityService.js`: remains the backend authority for
  PSK validation. Firmware must conform to its canonical payload.
- Existing route tests already cover PSK behavior; add or adjust tests only if
  the accepted request shape changes.
- `.env.example`: documents required runtime settings.

### Documentation

- `README.md` and `docs/2026-06-16-development-status.md`: update the current
  run path after repository-local env setup exists.
- New or updated hardware runbook: captures production-readiness validation
  steps and expected logs.

## Data Flow

1. Device boots and connects WiFi.
2. Firmware builds boot registration JSON.
3. If a PSK is configured, firmware adds timestamp, nonce, and HMAC signature.
4. Backend `/api/ota/check` calls `deviceIdentityService`.
5. Backend rejects invalid signed production requests before registering or
   returning OTA metadata.
6. Backend returns token, WebSocket URL, and optional OTA metadata.
7. Firmware validates OTA metadata, performs OTA, verifies SHA256, and reboots
   only after integrity succeeds.
8. Firmware reconnects to WebSocket and starts product logic.

## Error Handling

- Missing PSK on firmware with backend PSK disabled remains development-compatible.
- Missing or invalid signature with backend PSK enabled returns backend `403`.
- Stale timestamp and replayed nonce fail before registration.
- Missing OTA URL keeps current no-upgrade behavior.
- Malformed SHA256 fails fast with an invalid argument error.
- SHA256 mismatch aborts the boot upgrade and enters the existing fatal restart
  path instead of booting an untrusted image.

## Testing

Backend:

- keep `npm test` green;
- run focused PSK and OTA route tests after any request-shape changes.

Firmware:

- build with default development settings;
- build with production signing settings;
- verify unsigned dev boot against backend with `REQUIRE_DEVICE_PSK` disabled;
- verify signed boot against backend with `REQUIRE_DEVICE_PSK=true`;
- verify OTA success and SHA256 mismatch behavior on hardware.

Documentation:

- run through repository-local backend startup from `.env.example`;
- confirm the runbook contains concrete commands and expected observations.

## Open Decisions

- The exact firmware PSK storage mechanism for production devices is limited to
  a configurable test path in this phase. A later factory provisioning phase
  should decide whether keys live in NVS, efuse, encrypted flash, or a factory
  partition.
- HTTPS certificate embedding and rotation can start with a static certificate
  bundle, but a later phase should define rotation policy.
