# Cloud Paperclip → Local Agent Bridge Daemon

**Status:** spec locked 2026-04-20 — ready for v1 implementation
**Branch:** TBD (separate from `shadcn-integration`)
**Authors:** yuqings, Claude

## Goal

Let any user log in to a **cloud-hosted** Paperclip instance, run a small daemon on their laptop, and have the cloud UI automatically show their **local** agent runtimes (Claude Code, Codex, Cursor, etc.) as assignable agents. Creating an issue and assigning it to a local agent triggers execution on the user's laptop, with stdout streaming back to the cloud dashboard.

## Why this doesn't work today

Paperclip's `claude_local`/`codex_local` adapters invoke the CLI via `child_process.spawn` on the server host (`packages/adapters/claude-local/src/server/execute.ts`). A cloud deployment can only spawn binaries installed on the cloud host, not on a user's laptop.

## Architecture overview

```
 ┌────────────────────┐              ┌──────────────────────────┐           ┌──────────┐
 │   User's laptop    │   outbound   │    Cloud Paperclip       │  existing │  Browser │
 │                    │    wss://    │                          │    WS     │          │
 │  paperclip-bridge  │◀──────────▶ │  /bridge/ws endpoint     │◀────────▶│  UI      │
 │   (daemon)         │  (bidir,     │  bridge_devices table    │ /events   │          │
 │                    │   persistent)│  bridge_jobs table       │  /ws      │          │
 │  spawns:           │              │  live-events bus         │           │          │
 │   claude, codex…   │              │  UI: Devices, Agents     │           │          │
 └────────────────────┘              └──────────────────────────┘           └──────────┘
     laptop ↔ cloud                        cloud internal                   cloud ↔ browser
     (this proposal)                   (heartbeat.run.log bus)              (already built)
```

All network connections are **initiated by the laptop** — works behind any NAT/firewall, no inbound rules, no tunnel setup. The daemon opens one long-lived outbound WebSocket to the cloud.

**End-to-end streaming path:** daemon reads CLI stdout → sends WS `chunk` frame to cloud → cloud publishes `heartbeat.run.log` on the existing live-events bus → the browser's already-connected WebSocket (`server/src/realtime/live-events-ws.ts` ↔ `ui/src/components/transcript/useLiveRunTranscripts.ts`) delivers it to the transcript in real time. No new UI streaming code needed.

## User flow

1. Install: `npm i -g @paperclipai/bridge` or `brew install paperclipai/tap/bridge`.
2. Pair: cloud Devices page → "Add device" shows a 6-char code + expiry. User runs `paperclip-bridge pair XYZ123`.
3. Start: `paperclip-bridge start` (or install as launchd/systemd service).
4. Dashboard shows: `@yuqings's MacBook — ● online — Claude Code 1.2.3, Codex 0.5.0`.
5. Create issue → assign to `Claude on @yuqings's MacBook` → issue runs on laptop, output streams to UI.

## Components

### Cloud-side endpoints

**HTTP (pairing only, low-volume):**
- `POST /bridge/pair { code }` → exchanges one-time pairing code for `{ deviceToken, deviceId }`
- `POST /bridge/devices/revoke/:deviceId` — UI action to unpair

**WebSocket (main transport):**
- `wss://<host>/bridge/ws` — authenticated with `deviceToken` (header or query param on upgrade)

All job dispatch, stdout streaming, heartbeats, and cancellation flow over the single WS. Reuses the existing `ws` upgrade handler pattern from `server/src/realtime/live-events-ws.ts`.

**Server-side flow on each `chunk` frame:** publish `heartbeat.run.log` to the live-events bus for the relevant `companyId` + `runId` → browsers subscribed via the existing UI WebSocket receive it and append to the transcript (no new UI code).

### WebSocket message protocol

All messages are JSON. `type` field discriminates.

**Daemon → Cloud (client-sent):**
```jsonc
// On connect, right after upgrade:
{ "type": "register", "hostname": "macbook", "platform": "darwin-arm64",
  "runtimes": [{ "name": "claude", "version": "1.2.3", "path": "/opt/homebrew/bin/claude" }] }

// Every 30s while idle:
{ "type": "heartbeat", "ts": "2026-04-19T12:00:00Z" }

// While a job runs, many of these (one per stdout/stderr line or ~1 KB buffer):
{ "type": "chunk", "jobId": "job_abc", "stream": "stdout", "data": "...stream-json line...", "seq": 42 }

// When the CLI exits:
{ "type": "result", "jobId": "job_abc", "exitCode": 0, "durationMs": 18432 }

// Ack for a received control message:
{ "type": "ack", "jobId": "job_abc", "control": "cancel" }

// Response to a readFile request from the cloud (see below):
{ "type": "fileContent", "requestId": "req_123", "path": "src/foo.ts",
  "encoding": "utf8", "data": "...", "size": 1024, "modifiedAt": "2026-04-20T..." }

// Error response to a readFile (outside cwd, too large, not found, etc.):
{ "type": "fileError", "requestId": "req_123", "code": "OUT_OF_SCOPE", "message": "path escapes cwd" }
```

**Cloud → Daemon (server-sent):**
```jsonc
// Welcome, after successful auth + register:
{ "type": "hello", "serverTime": "2026-04-20T12:00:00Z", "protocolVersion": 1 }

// A job is ready to run. No `cwd` — daemon uses its configured root.
{ "type": "job", "jobId": "job_abc", "runtime": "claude", "prompt": "...",
  "env": { "...": "..." }, "timeoutMs": 600000 }

// Cancel a running job (user clicked Cancel in UI):
{ "type": "cancel", "jobId": "job_abc" }

// Pull a file's contents (triggered when UI opens a file viewer):
{ "type": "readFile", "requestId": "req_123", "path": "src/foo.ts", "maxBytes": 524288 }

// App-level ping (independent of WS frame ping):
{ "type": "ping" }
```

**File-read guarantees:**
- `path` is resolved relative to the daemon's configured cwd. Absolute paths and `..` traversal outside cwd return `OUT_OF_SCOPE`.
- `maxBytes` capped at 1 MB by the daemon regardless of request.
- Binary files returned as base64 with `encoding: "base64"`.
- Daemon may deny with `TOO_LARGE`, `NOT_FOUND`, or `ACCESS_DENIED` — never reads files outside the cwd allow-list.

### Laptop daemon (`@paperclipai/bridge`)
- **Pair command:** `paperclip-bridge pair XYZ123 [--cwd ~/projects/foo] [--name "MacBook"]` — exchanges pairing code for persistent device token; stores in OS keychain or `~/.paperclip/bridge.json` (0600) with the configured cwd and display name.
- **Config:** `paperclip-bridge config set cwd ~/projects/bar` / `get cwd` / `show` for later edits. Cwd is an absolute path, validated to exist at daemon start.
- **Capability prober:** on start and every 10 min, walks a whitelist of known CLI names, runs `<cli> --version`, captures `{ name, version, path }`. Re-sends `register` on change.
- **Connection manager:** opens WS, re-connects with exponential backoff + jitter on close/error (starting at 1s, capped at 60s). On reconnect, re-sends `register` and any in-flight `result` frames whose ack was lost.
- **Job executor:** on incoming `job`, spawns CLI via `execa` with prompt piped to stdin, `cwd` set to the configured root. Reads stdout/stderr line-by-line; for each line emits a `chunk` frame. Enforces `timeoutMs`. Supports `maxParallel` concurrent jobs (default 1).
- **File-read handler:** on `readFile`, resolves path against the configured cwd, rejects any resolved path that escapes cwd, rejects files over `maxBytes` (1 MB hard cap), returns utf8 or base64 contents.
- **Cancellation:** on incoming `cancel`, SIGTERM the CLI child process; escalate to SIGKILL after 5s.
- **Backpressure:** if WS `bufferedAmount` exceeds 1 MB, pause reading from CLI stdout until drained.
- **Self-update check** (optional v2).

### DB additions (cloud)
- `bridge_devices(id, user_id, display_name, hostname, platform, token_hash, last_seen, runtimes_json, configured_cwd, max_parallel, created_at)` — `configured_cwd` is advisory (surfaced in UI); enforcement happens on the daemon.
- `bridge_jobs(id, device_id, runtime, prompt, status, started_at, finished_at, exit_code, error)` — no `cwd` column since the daemon's configured root is the sole source of truth.
- Output chunks → reuse existing agent output/log table if possible.

### UI additions (cloud)
- **Devices page:** list devices with online indicator, last-seen time, detected runtimes, "Unpair" action, "Add device" modal (shows pairing code).
- **Agents catalog:** each device contributes one agent per detected runtime (`Claude Code on @yuqings's MacBook`).
- **Issue assignment:** existing assignee selector picks up bridged agents.

## Adapter integration

Instead of a brand-new adapter, package this as a **transport variant** of the existing `claude-local`/`codex-local` adapters. Pseudocode:

```ts
// In adapter: choose transport based on config
if (deployment.mode === "public" && job.bridgeDeviceId) {
  await bridgeExec(job.bridgeDeviceId, { runtime, prompt });
} else {
  await localExec({ runtime, prompt });
}
```

This keeps adapter semantics (heartbeats, result parsing) intact — bridge is just a remote spawn mechanism.

## Security model

- Device token is user-scoped. Revoking a user revokes their devices. Token hashed at rest (Argon2 or sha256+salt).
- Daemon only executes a hardcoded whitelist of runtime binary names (`claude`, `codex`, etc.) looked up via `which`. Prompts are passed via stdin, never as shell-expanded args.
- Cloud never sends shell commands — only `{ runtime, prompt, env }`. The daemon uses its own configured cwd; cloud cannot override it.
- `readFile` is the only filesystem operation the daemon exposes, and only within the configured cwd. No `writeFile`, no `exec`, no directory listing beyond what the agent itself does.
- TLS required; daemon rejects `ws://` URLs.
- WebSocket auth: token supplied via `Sec-WebSocket-Protocol` subprotocol header or signed query param — not logged.
- Rate limits on `chunk` frames (by `deviceId`) and maximum frame size (e.g. 64 KB per chunk).

## Multi-replica routing

If the cloud is deployed across multiple replicas behind a load balancer, a device's WS lands on one replica while jobs may be enqueued on another. Two options:

1. **Sticky routing by `deviceId`** — LB consistent-hashes the upgrade request on `deviceId`. Simple, but fragile during rolling deploys.
2. **Postgres LISTEN/NOTIFY (or Redis pub/sub)** — job-enqueue publishes on a channel keyed by `deviceId`; whichever replica holds the WS for that device consumes. Same pattern the existing live-events bus likely uses for `heartbeat.run.log` — reuse that infra.

**v1 assumption:** single-replica deployment. Defer multi-replica to v2.

## Decisions (locked 2026-04-20)

1. **Transport:** WebSocket. Reuses existing `ws` infrastructure, streams reasoning at low latency, supports bidirectional cancel.
2. **Working directory:** **one fixed root per device**, configured at pair time (`paperclip-bridge pair XYZ123 --cwd ~/projects/foo`) or later via `paperclip-bridge config set cwd ...`. The cloud job payload does *not* carry a `cwd` — the daemon always uses its configured root. Simpler UX, fewer attack surfaces.
3. **Filesystem artifacts:** **laptop-only storage, cloud reads on demand.** Files created by the agent stay on the laptop. The cloud pulls file content over the same WebSocket when the UI opens a file viewer (see `readFile`/`fileContent` frames below). No background sync, no S3, no "upload on write." Path access is restricted to the configured cwd.
4. **Multi-device same runtime:** **each device surfaces as a distinct agent**, labeled by device name (`Claude on MacBook`, `Claude on Linux-box`).
5. **Pairing UX:** **CLI paste flow.** Devices page shows a 6-char code; user runs `paperclip-bridge pair XYZ123`. No deep link / OS URL handler in v1.
6. **Quotas:** **no hard concurrency limit per device.** Daemon schedules as many concurrent jobs as its configured `maxParallel` (default: 1, user-configurable). Cloud does not enforce a ceiling.

## Phased delivery

- **v1 (MVP, ~1 week):** pair + WS register + job dispatch + stdout chunks + result + cancel. One runtime (`claude`). Single-replica cloud.
- **v1.1:** Codex + other runtimes, launchd/systemd service installer, robust reconnect, ack-resend for in-flight results.
- **v2:** Multi-replica routing via pub/sub, artifact upload, multi-working-dir, UI for device management.
- **v3:** Self-update, remote `--resume` passing conversation state, HTTP long-poll fallback transport for corporate networks that block WS upgrades.

## Non-goals

- Agents running on someone else's laptop (cross-user remote execution).
- File sync between cloud and laptop beyond stdout capture.
- Running agents that require interactive TTY (e.g. `claude` in interactive mode) — daemon drives non-interactive runs only.

## References

- Existing adapter: `packages/adapters/claude-local/src/server/execute.ts` (stream-json capture at line 432)
- Existing WS infrastructure to reuse:
  - Server: `server/src/realtime/live-events-ws.ts`
  - Client: `ui/src/components/transcript/useLiveRunTranscripts.ts` (subscribes to `heartbeat.run.log`, `heartbeat.run.event`, `heartbeat.run.status` — daemon chunks will publish on the same bus, so the UI path is zero-delta)
- Deployment modes: `doc/DEPLOYMENT-MODES.md`
- Heartbeat protocol: `docs/guides/agent-developer/heartbeat-protocol.md`
- Related roadmap item: "Cloud / Sandbox agents" (README.md:260)
