# FileTrail

**A file workspace built around recoverable uploads and traceable changes.**

FileTrail is a full-stack web application for uploading, organizing, versioning, and sharing files. Interrupted transfers can resume, previous versions remain accessible, and competing edits are preserved as conflict copies instead of silently overwriting content.

**React · TypeScript · Java · Spring Boot · PostgreSQL · S3-compatible storage**

[Quick start](#quick-start) · [Reliability design](#reliability-design) · [Testing](#testing) · [Architecture](docs/architecture.md) · [API reference](docs/api.md)

> **Status: stage-one web MVP.** The web workspace and version service are implemented. Local directory synchronization, a Python sync CLI, and registered device management are planned for stage two.

## What you can do

| Capability                   | Behavior                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Manage a workspace**       | Create folders, upload and download files, rename and move entries, and filter or sort the current list.                        |
| **Resume an upload**         | Pause, resume, cancel, or retry chunked transfers. After a page reload, reselect the original file to send only missing chunks. |
| **Browse version history**   | View timestamps, source labels, sizes, and SHA-256 checksums; download older content or restore it as a new version.            |
| **Preserve competing edits** | Submit updates against a base version. If the remote version has changed, the service saves a separate conflict copy.           |
| **Share a specific version** | Create an expiring, read-only link to fixed content and revoke future access.                                                   |
| **Recover deleted files**    | Restore files and their history from trash; inspect completed operations in the activity log.                                   |

The English-language UI uses a blue theme and supports desktop and mobile layouts. Transfer progress distinguishes **uploading chunks**, **validating and publishing**, and **published / conflict copy saved**.

## Quick start

### Run the full stack with Docker Compose

**Prerequisites:** Git, Python 3, and Docker Engine / Docker Desktop with Compose v2. The first build downloads images and dependencies, including compiling the local MinIO services from pinned official source. See [storage build details](docs/deployment.md#minio-source-builds).

```bash
git clone https://github.com/BoyangMu/FileTrail.git
cd FileTrail
python3 scripts/configure.py
docker compose up --build -d --wait --wait-timeout 180
```

Already cloned the repository? Run the last two commands from its root.

Open **[http://127.0.0.1:4173](http://127.0.0.1:4173)** and select **Create account**. No default accounts or sample files are created.

| Service          | Local address                    |
| ---------------- | -------------------------------- |
| Web application  | http://127.0.0.1:4173            |
| API health check | http://127.0.0.1:8081/api/health |
| MinIO console    | http://127.0.0.1:9001            |

The configuration script generates credentials in the gitignored `.env` file. Use its S3 credentials for the MinIO console. PostgreSQL and the S3 API remain internal to the Compose network.

```bash
# Inspect service status and API / worker logs
docker compose ps
docker compose logs --tail=100 api worker

# Stop services while keeping database and file volumes
docker compose down
```

**Adding `-v` to `docker compose down` deletes the database and file contents.** Compose is intended for local development and acceptance testing; see [deployment guidance](docs/deployment.md) before exposing the application publicly.

### Try the main workflow

1. Create an account, add a folder, and upload a file.
2. Select the file, upload revised content as a new version, and inspect its history.
3. Restore an earlier version. A new version appears, preserving the intervening history.
4. Share a selected version, open its link, then revoke it and try a new download.
5. Move the file to trash and restore it with its history intact.

For repeatable interruption and concurrent-update scenarios, use the [automated checks](#testing).

### Develop without Docker

Requires **Java 17–25**, **Maven 3.6.3+**, and **Node.js 22.12+**. This mode uses disk-backed H2 and local file storage. Use Compose to exercise PostgreSQL and S3 integration.

Start each terminal at the repository root.

**Terminal 1 — API:**

```bash
cd backend
mvn package
java -jar target/filetrail-0.1.0.jar --server.address=127.0.0.1
```

**Terminal 2 — frontend:**

```bash
cd frontend
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Backend data lives in `.data/` relative to its working directory. Stop the running JAR before rebuilding it, then restart the process.

## Reliability design

The backend is a **modular monolith with a separate cleanup worker**. PostgreSQL stores identities, metadata, and version relationships; object storage holds file bytes. The React client manages chunking, incremental hashing, and the transfer queue.

| Failure or operation                        | Implementation                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Connection drops during upload              | Persist acknowledged parts in an upload session; query progress before resuming. Sessions expire after seven days.                                           |
| A chunk or assembled file is corrupt        | Check chunk sizes and SHA-256 values, then verify the complete file before publication. Incomplete or invalid content does not become a visible version.     |
| A completion request is retried             | Return the upload session's recorded result. Session-creation request keys and restore-operation records protect those operations against duplicate effects. |
| Two clients update the same version         | Serialize writes per account and compare the submitted base version with the current version. Preserve stale updates in separate conflict files.             |
| Metadata commit fails after content storage | Leave no visible version; the cleanup worker can later reclaim unreferenced objects.                                                                         |
| A file is renamed, moved, or restored       | Keep its logical file ID stable. Restoring content appends a version rather than rewriting history.                                                          |

Publication follows a deliberate order:

1. Assemble uploaded parts and verify their sizes and hashes.
2. Write the complete content object to storage.
3. In one database transaction, create the version, update the current-version pointer, and record the upload result, activity, and change event.

Object storage and PostgreSQL do not share a transaction. Writing content first avoids publishing a database reference to an incomplete upload; reference-aware cleanup handles orphaned objects. See [architecture and consistency details](docs/architecture.md).

Accounts use BCrypt passwords, HttpOnly session cookies, and server-side ownership checks. Share tokens are stored as hashes and authorize downloads of a specific version.

## Limits and tradeoffs

- The API allows files up to **4 GiB**, chunks from 64 KiB to 4 MiB, and at most 10,000 chunks. The 4 GiB limit is a configuration limit, not a verified load capacity.
- The browser hashes incrementally. Publication requires temporary backend disk space equal to the complete file size.
- A changed local file cannot resume the original session. Cancel it and start a new upload.
- Browsers cannot automatically reopen local files after a reload. Reselect the original file; the server's confirmed chunk list determines what remains to upload.
- Writes are serialized per account using a database row lock. Large publications can delay other writes for that account; different accounts can proceed concurrently.
- Revocation blocks new share requests. It cannot recall an active download or an already saved copy. Moving a file to trash does not automatically revoke its links.
- Cleanup preserves history, trash, and referenced content. Permanent trash deletion is not implemented.
- Lists have no server-side pagination. Source labels are client-supplied descriptions, not authenticated device identities.
- Email verification, password reset, quotas, cross-user deduplication, binary auto-merge, and resumable downloads are not implemented.

## Testing

Run these commands **from the repository root**. Backend packaging is required before the restart check.

```bash
# Backend integration tests and packaged application
mvn -B -f backend/pom.xml verify

# Kill and restart an isolated backend to check persisted upload results
python3 scripts/restart_check.py

# TypeScript checks and production frontend build
npm --prefix frontend ci
npm --prefix frontend run build

# HTTP acceptance against the running Compose stack
python3 scripts/smoke.py --url http://127.0.0.1:4173

# Browser checks against the running Compose stack
(cd frontend && npx playwright install chromium)
(cd frontend && E2E_URL=http://127.0.0.1:4173 npm run test:e2e)
```

| Layer               | Coverage                                                                                                         | Source                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Backend integration | Idempotency, concurrent updates, access control, corruption, storage failures, transaction rollback, and cleanup | [ReliabilityTest.java](backend/src/test/java/dev/filetrail/ReliabilityTest.java) |
| Process recovery    | Forced termination during upload and after publication, followed by recovery and replay                          | [restart_check.py](scripts/restart_check.py)                                     |
| HTTP acceptance     | End-to-end API behavior against a running application                                                            | [smoke.py](scripts/smoke.py)                                                     |
| Browser             | File lifecycle, interrupted upload and resume after reload, and mobile layout                                    | [workspace.spec.ts](frontend/e2e/workspace.spec.ts)                              |

HTTP and browser checks create isolated test accounts. The [GitHub Actions workflow](.github/workflows/ci.yml) runs backend, restart, frontend, Compose HTTP, and browser checks on pushes and pull requests.

See the [dated verification record](docs/verification.md) for recorded local results and untested scenarios. The [performance baseline](docs/performance-baseline.json) contains development measurements with their test conditions; it does not establish production capacity.

## Repository guide

```text
backend/
  src/main/java/dev/filetrail/     # API, auth, workspace, uploads, storage, cleanup
  src/main/resources/db/migration/ # Flyway schema migrations
  src/test/                       # Integration and fault-injection tests
frontend/
  src/                            # React workspace and resumable transfer queue
  e2e/                            # Playwright browser scenarios and fixtures
scripts/                          # Configuration, acceptance, restart, benchmark
docs/                            # Design, API, deployment, verification, roadmap
compose.yaml                      # Web, API, PostgreSQL, MinIO, and worker
.github/workflows/ci.yml           # Automated verification pipeline
```

## Next steps

- **Strengthen the web service:** server-side pagination, workspace-wide search, quotas, and asynchronous validation with shorter database lock duration.
- **Add local directory sync:** a Python CLI with SQLite state, device registration, change cursors, restart recovery, and explicit conflict handling.
- **Expand operational evidence:** larger-file and concurrency tests, backup restoration drills, and documented deployment measurements.

Multi-device synchronization remains planned until the client and protocol are implemented and verified. See the [roadmap](docs/roadmap.md) for the remaining scope.

## Documentation

- [Architecture](docs/architecture.md) — storage, transactions, conflict handling, and cleanup.
- [API reference](docs/api.md) — endpoints and request semantics.
- [Deployment](docs/deployment.md) — configuration and production considerations.
- [Verification](docs/verification.md) — recorded checks, fault scenarios, and limitations.
- [Roadmap](docs/roadmap.md) — follow-up work and the sync-client plan.
