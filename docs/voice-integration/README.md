# Shared AEO Voice execution — deployment and session handoff

## Architecture and scope (2026-09-15)

AEO is the shared admin. `Rankings → Executions` (`/rankings/executions`, owner only)
queues immutable Type/Voice execution records. The Mac polls AEO over authenticated
HTTP; no inbound Mac/ADB port or separate Voice Admin is required.

```
AEO owner UI → AEO Postgres queue → Mac aeo_worker.py → voice_agent.py → Android
                    ↑                ↓
             result + PNG/WAV ← durable delivery outbox
```

Code lives in two repositories:

- **AEOAdmin:** execution schema, API, artifact storage, shared UI and API tests.
- **DeviceFarm1/voice-search:** `agent/aeo_worker.py` HTTP consumer,
  `agent/voice_agent.py` standalone runner, patched scrcpy, installation and parity
  documentation under `agent/`.

Voice dispatch is implemented. Type is represented in the same queue and lease
rules, but no production typed adapter is qualified here. The worker advertises
Voice only by default. Existing DeviceAgent Type jobs continue in their current
workflow. `--type-adapter` is an explicit extension contract, **not** a bundled
implementation. Do not assume legacy runners honor this queue's phone leases:
reserve the selected phones outside those legacy pools before starting a worker.

Historical `ranking_reports` remain unchanged. Explicit Voice imports to that
endpoint are rejected to prevent overwriting Type results by keyword/platform/day.
New executions are separate immutable evidence; they are not yet projected into
period comparisons, biweekly reports, exports or aggregate ranking metrics.

## Backend data saved

`ranking_executions` stores the keyword ID, mode, platform, assigned Mac/phone,
original versioned request, requested voice/proxy settings, timestamps, status,
result digest and complete result JSON. Result JSON includes recognized text,
exactness, raw answer, answer state, ranking, proxy details and `voice_trace`.
Each voice attempt records actual voice/engine, generated rate/pitch/defaults,
randomization seed when used, audio format/duration, hash and injection events.

Tone is null: emotional tone control is not implemented. UI input currently offers
macOS/Kokoro engine and variation, not arbitrary named voices/rate/pitch/seed.
Default macOS voice is Samantha. `mock_location_verified` remains false. The AEO
queue currently does not supply GPS coordinates/timezone or expected domain.

`execution_artifacts` stores each PNG/WAV manifest with size, SHA-256, storage key
and uploaded flag. Playback/download require an owner session. Uploads require the
executor token and matching worker ID, size and SHA-256. The Mac retains local
bundles and retries evidence delivery without repeating the phone execution.

Voice success requires `exact=true` plus successful engine completion; assistant
platforms also require `answer_state=complete`. Bing uses its search result success
condition. Evidence may still be uploading after the execution finishes; the UI
shows pending artifacts until uploads have completed.

## Install and deploy

1. In the voice-search repo, follow `agent/INSTALL.md` in full. Qualify each phone
   and platform. This is Mac-controlled silent injection, not an Android-only APK.
2. Back up AEO before applying the additive migration:
   `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0003_ranking_executions.sql`.
   Do not use `drizzle-kit push` on existing/production databases. Existing auth
   migrations/session tables must already be installed; the execution migration
   intentionally does not create or rewrite authentication tables.
3. Configure AEO API `EXECUTOR_TOKEN` using a private secret. Existing session/auth
   settings remain required. For production set `EXECUTION_ARTIFACT_BUCKET` to a
   private S3 bucket and `AWS_REGION`; the API role needs GetObject/PutObject under
   `executions/`. Production refuses local artifact fallback. For local development
   set `EXECUTION_ARTIFACT_DIR` to a durable writable directory.
4. Build/deploy API and admin together after migration. If UI/API have different
   origins, use the existing `VITE_API_URL`, credentialed CORS and session-cookie
   configuration. Audio/image requests use credentials; bucket objects stay private.
5. On the Mac, set `AEO_EXECUTOR_TOKEN` to the API's executor token using private
   service configuration (do not put secrets in Git or command-line arguments).
   Start one sequential consumer per controlling Mac:

   ```sh
   python3 agent/aeo_worker.py \
     --api https://YOUR-AEO-API \
     --worker-id YOUR-UNIQUE-MAC-ID \
     --serial 'EXACT_CURRENT_ADB_SERIAL' \
     --state-dir "$HOME/.local/state/voice-search/aeo"
   ```

   Repeat `--serial` for additional qualified devices. Use a stable worker ID and
   persistent state directory; do not reuse a worker ID on another live Mac.
   One consumer executes one job at a time. The current queue sets gost port 12001;
   multiple consumers on one Mac require port allocation work before enabling
   concurrency. Host locks refuse conflicting ports/phones instead of racing.
   Launch via the host's normal service supervisor with absolute executable/working
   directory paths and the same environment/PATH used for qualification.
6. Open **Rankings → Executions** as an owner. Select Voice, platform, keyword,
   online worker and phone. Optionally override the prompt and enable proxy/voice
   variation. Queue the audit; inspect exact transcript, voice attempts, WAV and PNG.

No database credentials belong on the phone or in the worker request. The Mac
needs the AEO token plus its local proxy credentials when proxy is selected.
Token holders are trusted fleet executors; the token is shared authorization, not
per-worker cryptographic identity. Use HTTPS for non-loopback deployment.

## HTTP contract

All paths below are under `/api/executions`.

| Route | Auth | Behavior |
|---|---|---|
| `POST /worker/heartbeat` | executor token | `{workerId,devices:[serial],modes:["voice"]}` every 20 seconds; offline after 90 seconds |
| `POST /worker/claim` | executor token | `{workerId}`; returns assigned running/queued record or 204 |
| `POST /:id/finish` | executor token | `{workerId,bundle}`; identical replay accepted, conflicting replay 409 |
| `PUT /:id/artifacts/:n` | executor token + X-Worker-Id | Raw `audio/wav` or `image/png`, maximum 20 MiB; checksum checked |
| `GET /workers` | owner | Advertised modes/devices and online state |
| `POST /` | owner | `{keywordId,mode,platform,workerId,deviceSerial,phrase?,voice?,proxy?}` creates UUID request |
| `GET /?mode=voice` | owner | Latest 200 execution summaries |
| `GET /:id` | owner | Full request/result and artifact upload states |
| `POST /:id/cancel` | owner | Cancels queued job; running job is marked and allowed to finish |
| `GET /:id/artifacts/:n` | owner | Authenticated playback, byte ranges; `?download=1` attachment |

Pass `X-Executor-Token` on executor routes. See voice-search's
`agent/AEO-INTEGRATION.md` for the strict version-1 request/result bundle fields.
The `id` UUID and `request.request_id` are identical. Owner queue submissions create
new executions; deliberately re-queueing a prompt is a new phone run. Delivery
retries use the same ID and never POST a replacement execution.

## Recovery, cancellation and device ownership

The DB partial unique index permits only one running execution per hardware ID,
including mDNS aliases, across both modes and workers. Claims serialize by worker
and hardware. Worker restart receives the same running job. No timeout automatically
releases/requeues a phone: losing heartbeat does not prove the phone stopped.

The Mac persists `ID.pending.json` before finishing/uploading. A connection failure
leaves this outbox entry intact. Restart with the same state directory to replay
finish/uploads. A completed `runs/ID/result.json` is reused without another device
run. A request directory without final result is refused and requires reconciliation.
4xx API rejection stops the consumer with its outbox retained; fix auth/conflicting
state before restart. 5xx/network failures retry. Do not delete state to force retry.

A queued cancellation prevents execution. A running cancellation is informational:
current execution finishes and performs cleanup; its success/error remains truthful.
For an interrupted job, stop the owning process, confirm no child scrcpy/voice
process remains, restore the selected phone's VPN state and inspect evidence. Only
then have an operator mark that specific execution error using a reconciled result
through `/finish`, or a reviewed DB correction. Create a new UUID only for an
explicit rerun. There is no automatic force-release endpoint.

## Validation and current rollout boundary

- Isolated database `aeo_execution_test_20260915` on local Postgres :5433; API :8100,
  UI :8101. Neither production AEO nor legacy Voice Admin data was migrated.
- `scripts/test-ranking-executions.mjs` exercises owner/executor auth, mode
  capabilities, Type/Voice hardware exclusion across aliases, restart claims,
  immutable completion, exactness, cancellation and evidence hashes/ranges.
  It uses synthetic results, not platform qualification. Run only against a test
  environment with a seeded active keyword/owner and these private environment
  values: `TEST_API_URL`, `TEST_ADMIN_EMAIL`, `TEST_ADMIN_PASSWORD`,
  `TEST_KEYWORD_ID`, `EXECUTOR_TOKEN`.
- Voice-search Python suite covers interrupted requests, durable bundle replay,
  upload outage/replay and path confinement, in addition to engine checks.
- Browser checks cover the shared page and capability-gated controls. Live AEO
  Voice/Bing execution `2247a318-512e-4c2f-8c3a-c5f905d47707` passed on Samsung
  SM-A075F with exact full prompt recognition in 105.5 seconds. Samantha metadata,
  278040-byte WAV and 624098-byte PNG were persisted/uploaded; both downloads
  matched hashes. UI audio decoded (8.686313 seconds), and screenshot rendered.
  Use `http://localhost:8101` for the preview: existing CORS permits localhost,
  not the 127.0.0.1 origin for credentialed media requests.
- API/UI builds and UI typecheck pass. Full repository typecheck currently fails
  in unchanged generated API exports and legacy route parameter typings; this is
  not a clean repository-wide typecheck. Python: 229 tests, OK (3 skipped).
- Production rollout still requires S3/HTTPS verification, each intended platform
  on the target devices, typed adapter qualification before queueing Type, and a
  mode-aware historical reporting projection if those reports should include Voice.

Retire the old Voice Admin only after production AEO smoke tests and a verified
backup of its database and all media. Its code/data remain rollback material for
now; standalone Voice execution already works without those services.
