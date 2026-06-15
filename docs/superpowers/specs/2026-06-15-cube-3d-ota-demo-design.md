# Cube 3D OTA Demo Design

## Goal

Turn `/Users/wq/Workshop/MCU/claude-demos/cube_3d_v1.0` into an EspLink firmware demo that keeps the normal boot registration and OTA upgrade path.

## Context

The source demo is a standalone ESP-IDF application. Its build uses a 4MB single-app partition table and defines its own `app_main`, so its existing `cube_3d.bin` is not suitable as an EspLink OTA artifact.

EspLink firmware already provides:

- WiFi provisioning
- boot registration through `POST /api/ota/check`
- WebSocket connection after registration
- OTA download through `esp_https_ota`
- OTA partitions through `partitions.csv`

## Design

The cube demo is integrated as a product module inside `esplink-firmware`, not as a separate application.

- Copy the display and IMU board support files into the EspLink firmware `main` component.
- Move the cube rendering loop out of `app_main` into `app_cube_demo_start`.
- Keep EspLink `main.c` as the only application entry point.
- Start the cube demo after boot registration succeeds and the device enters the online state.
- Keep `BOARD_TYPE` as `esplink-v1` for compatibility with the currently flashed device and backend release flow.
- Bump `BOARD_FIRMWARE_VERSION` to `1.0.2` so the backend can publish it as a normal upgrade from the flashed `1.0.1` base firmware.

## OTA Behavior

The resulting `esp32s3_device.bin` is an EspLink app binary. It can be uploaded through the firmware release UI and served to devices through the existing `/firmware/<filename>.bin` static route.

After OTA, the device still has the OTA client. Future releases can replace or update this demo over the air.

## Validation

- Build `esplink-firmware` successfully with ESP-IDF.
- Confirm the generated app fits in the `0x180000` OTA app partition.
- Record artifact size and SHA256 for upload.
- Do not flash automatically as part of this integration step unless explicitly requested.
