# AGENTS.md

Current agent guidance for the EspLink backend package.

## Repository Context

The active monorepo root is `/Users/wq/EspLink`.

- Backend: `backend/`
- Admin frontend: `backend/admin-frontend/`
- Firmware: `esplink-firmware/`
- WeChat mini program: `esplink-app/`

Do not use older Windows paths, `/Users/hushaohong/...`, or `/Users/wq/ai_deploy_backend` as current commands. Those paths only appear in historical records.

## Current Status Sources

Read these first before changing production/OTA behavior:

- `../docs/2026-06-16-development-status.md`
- `../docs/2026-06-16-production-readiness-regression.md`
- `../docs/2026-06-19-production-security-design.md`
- `../docs/superpowers/plans/2026-06-19-production-completion.md`

## Backend

The backend is Node/Express on port `8088`, with Prisma/MySQL and Redis. It owns:

- admin API under `/api/v1`;
- EspLink firmware and mini program API under `/api`;
- device WebSocket at `/ws/device`;
- firmware artifact upload and release management;
- OTA decision preview and OTA result recording;
- production PSK verification when `REQUIRE_DEVICE_PSK=true`;
- multi-tenant LLM provider proxying.

Useful commands:

```bash
cd /Users/wq/EspLink/backend
cp .env.example .env
npm install
npm run db:generate
npm test -- --runInBand
npm start
```

When tests use Supertest, they need local port binding. In restricted sandboxes, rerun backend tests outside the sandbox if `listen EPERM` appears.

## Admin Frontend

```bash
cd /Users/wq/EspLink/backend/admin-frontend
npm install
npm run build
npm run dev
```

The firmware release page supports:

- `.bin` upload with URL/SHA256/size autofill;
- duplicate version hint;
- active release stop confirmation;
- OTA result summary;
- read-only OTA decision preview.

## Firmware

Current validated board:

- Board type: `esplink-v1`
- Firmware version: `1.0.5`
- Hardware port used in recent validation: `/dev/cu.usbmodem112301`
- Device MAC: `10:51:DB:80:E2:E8`

Default repo config keeps local WiFi injection, production transport, and compile-time PSK disabled. Do not commit local WiFi credentials, local PSK, `backend/.env`, or `backend/uploads/`.

Build:

```bash
cd /Users/wq/EspLink/esplink-firmware
source /Users/wq/esp-idf/export.sh
idf.py build
```

Local hardware flash:

```bash
idf.py -p /dev/cu.usbmodem112301 flash monitor
```

## Mini Program

The mini program uses:

- `pages/index`: bound device list with online state, firmware, board type, binding state;
- `pages/scan`: BLE scan;
- `pages/provision`: BluFi provisioning with retry/failure actions;
- `pages/success`: lookup and bind after provisioning;
- `utils/api.js`: backend API wrapper.

Static tests:

```bash
cd /Users/wq/EspLink/esplink-app
node --test tests/*.test.js
```

BLE flows still require WeChat DevTools real-device testing; the simulator does not support BLE.

## Remaining Non-Code Validation

As of 2026-06-20, the ordinary code/documentation closure is complete. Remaining items are hardware/deployment-gated:

- boot-fail OTA automatic rollback;
- backend restart and WebSocket recovery;
- real-domain HTTPS/WSS certificate validation.
