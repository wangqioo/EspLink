# 2026-06-19 Production Security Design

This document records the production security operating model after the first
signed boot and signed OTA-result hardware validations passed.

## Scope

Covered:

- per-device PSK storage and rotation;
- HTTPS/WSS domain and certificate lifecycle;
- admin-side key operations;
- hardware validation gates before shipping.

Not covered:

- full secure-boot rollout;
- flash-encryption manufacturing scripts;
- public domain and certificate provisioning, because those depend on the final
  deployment environment.

## Device PSK Storage

Current validation uses `CONFIG_ESPLINK_BOOT_PSK` only for local hardware tests.
That is acceptable for proving the protocol, but production builds must not keep
shared secrets in committed `sdkconfig` or source files.

Recommended production path:

1. Generate one random PSK per device during manufacturing.
2. Store the backend copy in `production_keys.psk_encrypted`.
3. Inject the device copy during manufacturing into a device-local secret store.
4. Enable flash encryption for production devices before shipping.
5. Keep `CONFIG_ESPLINK_BOOT_SIGNATURE_REQUIRED=y` for production builds.

Storage options:

- Factory partition: easiest to manufacture and audit; works well if protected
  by flash encryption.
- NVS namespace: simple runtime API and supports future rotation; should be used
  only with flash encryption in production.
- eFuse-backed derivation: strongest long-term option, but requires a more
  careful manufacturing flow and recovery story.

Near-term choice: use an NVS/factory-partition injected per-device PSK with
flash encryption enabled for production. Keep compile-time PSK only as a local
validation shortcut.

## Request Signing

Firmware signs both boot registration and OTA result reports with:

```text
mac
sn
timestamp
nonce
```

Backend requirements:

- reject missing signatures when `REQUIRE_DEVICE_PSK=true`;
- reject unknown or inactive `production_keys`;
- reject stale timestamps;
- reject nonce replay;
- update `last_nonce` and `last_seen_at` after accepted signed requests.

Hardware validation already proved:

- signed boot registration succeeds after firmware forces SNTP sync;
- signed OTA `started` and terminal result reports are accepted by backend;
- local HTTP validation remains usable because the firmware only attaches the
  ESP-IDF crt bundle for HTTPS/WSS URLs.
- interrupted download, wrong SHA, boot-fail rollback, and backend restart
  recovery all pass on the current ESP32-S3 validation board.

## Key Lifecycle

Admin operations should support these states:

- create: insert a per-device key before the device is shipped;
- observe: inspect `last_nonce` and `last_seen_at`;
- rotate: issue a replacement PSK, deliver it through a trusted maintenance
  path, then disable the old key;
- revoke: set `is_active=false` immediately when a device is lost or suspected
  compromised.

Rotation is not yet automated in firmware. Until it is, PSK rotation is an
operational procedure requiring physical service access or a trusted signed
maintenance build.

## HTTPS/WSS Domain Strategy

Production devices must use:

- HTTPS boot registration and OTA result URL;
- HTTPS firmware artifact URLs;
- WSS device WebSocket URL;
- a certificate chain trusted by the ESP-IDF crt bundle.

Deployment model:

1. Public domain terminates TLS at a reverse proxy.
2. Proxy forwards HTTP and WebSocket traffic to the Node backend.
3. `PUBLIC_BASE_URL` and `FIRMWARE_PUBLIC_BASE_URL` use `https://...`.
4. `WS_BASE_URL` uses `wss://...`.
5. `NODE_ENV=production` enables backend production transport validation.
6. Firmware production builds enable `CONFIG_ESPLINK_PRODUCTION_TRANSPORT=y`.

Certificate lifecycle:

- use a public CA certificate chain compatible with the ESP-IDF crt bundle;
- monitor expiry before the final 30 days;
- renew certificates on the reverse proxy first;
- run one signed boot and one OTA-check hardware validation after renewal;
- avoid pinning a leaf certificate until a rotation mechanism exists.

Current blocker: true-domain HTTPS/WSS hardware validation needs a real domain,
certificate, and reverse proxy. Local HTTP validation cannot prove public TLS
behavior.

## Release Gates

Before a production firmware release is shipped:

| Gate | Current status | Notes |
|------|----------------|-------|
| backend test suite | passed | Re-run before each release candidate |
| admin frontend build | passed | Re-run before each release candidate |
| mini program static tests | passed | BLE still needs WeChat DevTools real-device checks |
| default firmware build | passed | Default config disables local WiFi injection and compile-time production PSK |
| signed boot hardware validation | passed | `REQUIRE_DEVICE_PSK=true` local hardware validation complete |
| signed OTA result validation | passed | OTA `started` and terminal result reports signed and accepted |
| wrong SHA hardware validation | passed | Device reports `sha_mismatch` and keeps current firmware |
| interrupted download hardware validation | passed | Device reports `download_failed` and recovers |
| boot-fail rollback hardware validation | passed | Temporary `1.0.8` crash image rolled back to `1.0.5` |
| backend restart/WebSocket recovery | passed | Firmware retries and reconnects after backend restart |
| per-device PSK manufacturing injection | pending production process | Required before shipping; local compile-time PSK is validation-only |
| HTTPS/WSS true-domain validation | pending deployment infrastructure | Requires real domain, certificate, and reverse proxy |
