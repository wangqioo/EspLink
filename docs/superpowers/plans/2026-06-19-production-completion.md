# Production Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Track progress by updating the checkbox items below.

**Goal:** Close the remaining EspLink production-readiness work after signed boot, OTA result reporting, wrong-SHA rejection, and interrupted-download recovery have passed hardware validation.

**Architecture:** Keep firmware and backend production security decisions explicit in runbooks and design docs, while finishing the operator-facing surfaces in the existing admin frontend and mini program. Hardware-only validation items stay in the regression runbook with clear pass/fail evidence. Environment-gated items such as public HTTPS/WSS are documented as blocked until a real domain, certificate, and reverse proxy are available.

**Tech Stack:** ESP-IDF C, Node.js/Express, Prisma/MySQL, React/Vite admin frontend, WeChat mini program, Jest/Node test runner, Markdown docs.

---

## File Structure

- Modify: `docs/2026-06-16-development-status.md`
  - Refresh the current status and remove stale "still needs signed PSK validation" wording.
- Modify: `docs/2026-06-16-production-readiness-regression.md`
  - Record backend restart/WebSocket recovery and boot-fail rollback results when executed.
- Create: `docs/2026-06-19-production-security-design.md`
  - Document production PSK storage, certificate/domain lifecycle, and key rotation operating model.
- Modify: `backend/admin-frontend/src/pages/Firmware/index.jsx`
  - Add duplicate-version guidance, old-release deactivate action, and OTA-check preview after create.
- Modify: `backend/src/routes/firmware.js`
  - Add small admin API support only if the current firmware APIs cannot support the frontend workflow.
- Modify: `backend/src/tests/firmwareRoutes.test.js`
  - Cover any firmware route behavior added for admin UX.
- Modify: `esplink-app/pages/index/index.*`
  - Show online state, firmware version, board type, and binding state in the device list.
- Modify: `esplink-app/pages/provision/provision.*`
  - Add failure and retry states without changing the existing BLE provisioning contract.
- Modify: `esplink-app/tests/provisionInputContract.test.js`
  - Extend static coverage for the provisioning retry/failure UI.

## Task 1: Refresh The Development Status Entry

- [x] Mark signed production boot and signed OTA result reporting as hardware-validated.
- [x] Mark interrupted download as hardware-validated.
- [x] Keep HTTPS/WSS true-domain validation as environment-gated.
- [x] Keep boot-fail rollback and backend restart/WebSocket recovery as the next hardware checks until executed.
- [x] Mark boot-fail rollback and backend restart/WebSocket recovery complete after hardware validation.

## Task 2: Production Security Design

- [x] Document production PSK storage options: factory partition, NVS with flash encryption, and eFuse-backed derivation.
- [x] Pick the near-term recommended path for EspLink: per-device PSK injected during manufacturing, protected by flash encryption for production builds, never stored in Git.
- [x] Document certificate/domain strategy: public HTTPS/WSS domain, reverse proxy termination, ESP-IDF crt bundle, expiry monitoring, and staged rotation.
- [x] Document admin key lifecycle: create, rotate, disable, audit last nonce/seen time, and emergency revoke.

## Task 3: Admin Firmware Release UX

- [x] Add a visible duplicate-version hint when the entered board/version already exists in loaded releases.
- [x] Add a quick deactivate action for active old releases with confirmation.
- [x] Show an OTA-check preview after release creation so the operator can see whether a representative device would receive the release.
- [x] Reuse existing firmware release APIs where possible.
- [x] Add focused route tests only if backend behavior changes.

## Task 4: Mini Program Device Status UX

- [x] Update the device list to show online/offline, firmware, board type, and binding state.
- [x] Keep device cards dense and action-oriented; do not expose OTA management in the mini program.
- [x] Add provisioning failure copy and a retry entry that returns to the scan/provision flow.
- [x] Extend existing static tests so WXML/JS contract regressions are caught without WeChat DevTools.

## Task 5: Hardware Regression Closure

- [x] Backend restart/WebSocket recovery: with the board online, restart backend and confirm device reconnects.
- [x] Boot-fail rollback: OTA a deliberately crashing image that passes download and SHA checks, then confirm bootloader rolls back to the previous valid app.
- [x] Record exact serial/database evidence in `docs/2026-06-16-production-readiness-regression.md`.
- [x] Disable any temporary firmware release rows used during testing.
- [x] Restore firmware config to default development settings before commit.

## Task 6: Verification And Publish

- [x] Run backend tests affected by firmware/admin changes.
- [x] Run admin frontend build.
- [x] Run mini program static tests.
- [x] Build firmware with default development settings.
- [x] Confirm `git status --short` has no secret/config artifacts.
- [x] Commit and push to `origin/main`.
