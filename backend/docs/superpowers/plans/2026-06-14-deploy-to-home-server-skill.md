# Deploy to Home Server Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a reusable Codex skill that deploys arbitrary projects to the home 4060Ti server and creates a verified FRP tunnel.

**Architecture:** Keep operational judgment in a concise `SKILL.md` and non-secret topology in one reference file. Do not add deployment scripts until repeated real deployments reveal a stable interface worth automating.

**Tech Stack:** Codex skills, Markdown, SSH, FRP, Docker/PM2/systemd

---

### Task 1: Scaffold the skill

**Files:**
- Create: `~/.codex/skills/deploy-to-home-server/SKILL.md`
- Create: `~/.codex/skills/deploy-to-home-server/agents/openai.yaml`
- Create: `~/.codex/skills/deploy-to-home-server/references/infrastructure.md`

- [x] **Step 1: Run the official skill initializer**

Run `init_skill.py deploy-to-home-server` with a references directory and interface metadata.

- [x] **Step 2: Verify the scaffold exists**

Run `find ~/.codex/skills/deploy-to-home-server -maxdepth 3 -type f`.

### Task 2: Write the operational instructions

**Files:**
- Modify: `~/.codex/skills/deploy-to-home-server/SKILL.md`
- Create: `~/.codex/skills/deploy-to-home-server/references/infrastructure.md`

- [x] **Step 1: Write the trigger and deployment workflow**

Cover project inspection, deployment selection, preflight, rollback preparation,
local verification, FRP allocation, public verification, and reporting.

- [x] **Step 2: Add non-secret infrastructure facts**

Record the SSH endpoint, FRP path, naming rule, and port ranges without copying
tokens, passwords, private keys, or dashboard credentials.

### Task 3: Validate and dry-run

**Files:**
- Test: `~/.codex/skills/deploy-to-home-server/`

- [x] **Step 1: Run the official validator**

Run `quick_validate.py ~/.codex/skills/deploy-to-home-server`.
Expected: `Skill is valid!`

- [x] **Step 2: Scan for leaked credentials and placeholders**

Search for known repository credential strings plus `TODO` and `TBD`.
Expected: no matches.

- [x] **Step 3: Check three representative scenarios**

Confirm the instructions cover Docker first deploy, PM2 update, and systemd
deployment with FRP failure rollback without connecting to the live server.

- [x] **Step 4: Confirm discoverability**

Verify `agents/openai.yaml` references `$deploy-to-home-server` and the installed
skill is under `~/.codex/skills`.
