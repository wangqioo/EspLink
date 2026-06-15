# Deploy to Home Server Skill Design

## Goal

Create a reusable Codex skill for deploying any user-selected project to the
home `4060Ti-Server`, then creating and verifying an FRP tunnel so the deployed
service is publicly reachable.

The skill must not assume the project is `ai_deploy_backend`. It applies when
the user asks to deploy the current or named project to the home server.

## Target Environment

- SSH target: `wq@<your-public-host>`
- SSH port: `6004`
- Target device: `4060Ti-Server`
- FRP client config: `/opt/frp/frpc.toml`
- FRP service: `frpc`
- FRP manager process: `frp-manager`
- Tunnel prefix: `4060ti`
- Preferred public application port range: `7001-7999`
- Other allowed ranges: `6000-6299` and `10000-20000`

Use SSH keys available on the local machine. Do not store passwords, private
keys, FRP tokens, or dashboard credentials in the skill.

## Skill Trigger

Trigger for requests such as:

- "Deploy this project to my home server."
- "Put this app on the 4060Ti."
- "Deploy it at home and give me a public URL."
- "Update the home-server deployment."

Do not trigger for deployments to Spark2, cloud providers, laboratory devices,
or other FRP-managed devices unless the user explicitly changes the target.

## Deployment Workflow

### 1. Inspect the Project

Determine:

- project name and repository root;
- runtime and package manager;
- build and start commands;
- required environment variables;
- persistent data and migration requirements;
- health-check path or another reliable readiness check;
- local listening port;
- supported process manager.

Prefer an existing deployment definition in this order:

1. Docker Compose or Dockerfile;
2. an established PM2 configuration;
3. an established systemd unit or installation script;
4. a conservative project-specific PM2 or systemd deployment.

Do not silently invent missing production secrets. Ask for required values or
use values already provisioned on the server.

### 2. Preflight

Before modifying the server:

- verify SSH connectivity and host identity;
- inspect disk space, runtime availability, and target directory;
- inspect the current deployment and process state;
- identify the project's local port;
- check that the local port is not owned by an unrelated service;
- query current FRP tunnels and allocated remote ports;
- select the first available port in `7001-7999`.

Use `10000-20000` only if the preferred range is exhausted. Do not allocate
from `6000-6299` for ordinary applications because that range contains device
and infrastructure endpoints.

### 3. Prepare a Rollback Point

For an existing deployment:

- record the current Git commit or image tag;
- preserve the current environment and service definition;
- back up files that will be replaced;
- record the current FRP block, if one exists.

For a first deployment, record which files, directories, processes, and tunnel
entries are newly created so they can be removed on failure.

### 4. Deploy

Deploy into a stable server-side project directory. Reuse an existing directory
when updating a known deployment. Follow the project's own documented build and
start process.

Keep persistent data outside disposable release artifacts. Run database
migrations only when the project requires them and a rollback or compatibility
strategy is understood.

Start or reload the service with its selected process manager. Avoid restarting
unrelated services.

### 5. Verify the Local Service

Before changing FRP:

- verify that the process remains running;
- verify that the expected port is listening;
- call the health endpoint when available;
- otherwise perform a protocol-appropriate local request;
- inspect recent logs for startup failures.

Do not create or report a public endpoint for a service that fails local
verification.

### 6. Create or Update the FRP Tunnel

Use the tunnel name `4060ti-<normalized-project-name>`. Normalize the project
name to lowercase ASCII letters, digits, and hyphens. Preserve an existing
project tunnel and remote port when updating it unless the port conflicts or
the user requests a change.

For a new tunnel:

- re-query active and configured tunnels immediately before allocation;
- select an unused remote port;
- back up `/opt/frp/frpc.toml`;
- append one TCP proxy block targeting `127.0.0.1:<local-port>`;
- validate the resulting TOML;
- restart `frpc`;
- confirm the tunnel appears online in the FRP server state.

Prefer safe server-side file editing over sending secrets through command-line
arguments. Never overwrite the whole FRP configuration without preserving and
checking its existing content.

### 7. Verify Public Access

Verification has three required layers:

1. process and local port are healthy on the 4060Ti;
2. the named FRP tunnel is online and maps the selected remote port;
3. a request from the local workstation reaches
   `<your-public-host>:<remote-port>`.

Use HTTP checks for HTTP services and protocol-appropriate connectivity checks
for non-HTTP services. Deployment is incomplete until all applicable checks
pass.

### 8. Failure and Rollback

On application deployment failure:

- retain useful logs;
- restore the previous release and service definition;
- restart the previous service;
- verify the previous local service is healthy.

On FRP configuration or public verification failure:

- restore the FRP backup;
- restart `frpc`;
- verify pre-existing tunnels remain online;
- keep the application running only if it is locally healthy and explicitly
  report that public access failed.

Never delete an existing tunnel, process, directory, database, or persistent
volume unless it is clearly owned by the current project and deletion is
required for rollback.

## Output Contract

After a successful deployment, report:

- project and deployed revision;
- server deployment directory;
- process manager and service/process name;
- local listening port;
- FRP tunnel name;
- public host and port, including an `http://` or `https://` URL when valid;
- verification results;
- log command;
- rollback point.

If deployment fails, report the failing stage, relevant error summary,
rollback result, and whether the previous service and FRP tunnels remain
healthy.

## Skill Structure

Install the skill at `~/.codex/skills/deploy-to-home-server/` with:

- `SKILL.md`: triggers, safety rules, and the end-to-end workflow;
- `references/infrastructure.md`: non-secret device and FRP topology details;
- `scripts/`: only deterministic helpers that prove useful during
  implementation, such as tunnel-name normalization or remote-port selection.

Do not copy the repository's embedded FRP token or dashboard password into any
skill file.

## Validation

- Run the skill validator.
- Check that no credential-like strings from `frp-manager` were copied.
- Test deterministic helper scripts locally if any are added.
- Perform a dry-run reasoning test against representative Docker, PM2, and
  systemd projects without connecting to or modifying the production server.
- Do not forward-test by deploying to the live home server without a separate
  explicit user request.
