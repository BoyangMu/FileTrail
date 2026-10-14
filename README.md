# FileTrail

A full-stack file workspace with resumable uploads, immutable version history, conflict preservation, and revocable sharing. Built with React, TypeScript, Java / Spring Boot, PostgreSQL, S3-compatible storage, and a cleanup worker.

**Current release: stage-one web MVP.** Local directory synchronization, a Python sync CLI, and registered device management are planned for stage two. Server-side conflict protection can already be exercised through separate browser sessions or API clients.

## Quick start

### Docker Compose

Requires Docker Engine / Docker Desktop and Compose v2. The first build downloads images and dependencies.

```bash
python3 scripts/configure.py
docker compose up --build -d
```

Open [FileTrail](http://127.0.0.1:4173) and select **Create account**. No default accounts or sample business files are created.

- Web app: `http://127.0.0.1:4173`
- API health: `http://127.0.0.1:8081/api/health`
- Local MinIO console: `http://127.0.0.1:9001`. Credentials are generated in `.env`; never commit this file.
- PostgreSQL and the S3 API are internal to the Compose network.
- `docker compose down` stops services and preserves volumes. **Adding `-v` deletes the database and file contents.**

Compose is a local development and acceptance environment. Its pinned MinIO Community image is used for local S3 compatibility testing. Public deployments require maintained storage infrastructure, TLS, and scoped credentials; see [Deployment](docs/deployment.md).

### Development without Docker

Requires Java 17–25, Maven 3.6.3+, and Node 22.12+. This mode uses **H2 on disk and local file storage**; it does not validate PostgreSQL or S3 integration.

Terminal one:

```bash
cd backend
mvn package
java -jar target/filetrail-0.1.0.jar --server.address=127.0.0.1
```

Terminal two:

```bash
cd frontend
npm ci
npm run dev
```

Open [the development app](http://127.0.0.1:5173). Data is stored in `.data/` relative to the backend's working directory. Stop the old process before replacing its JAR, then restart it.

## Features

| Feature                  | Behavior                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts                 | BCrypt passwords, HttpOnly session cookies, server-side ownership checks                                                               |
| Workspace                | Folders, upload/download, rename/move, list/grid views, name filtering and sorting within the current list                             |
| Resumable uploads        | 4 MiB default chunks, pause/resume/cancel, SHA-256 checks, seven-day sessions; reselect the original file after a page reload          |
| Version history          | Timestamps, source, size, checksum, historical downloads; restoring creates another version                                            |
| Conflict preservation    | Base-version checks preserve competing content as a separate file; inspect the original and resolve by keeping both                    |
| Version-specific sharing | Expiring, revocable links; authenticated-by-token streaming; the token is shown only when created                                      |
| Trash                    | Restore files and their history; nonempty folders must be emptied first; no automatic permanent deletion                               |
| Activity                 | Upload, folder, move, restore, delete, share, revoke, and conflict events                                                              |
| Cleanup worker           | Expired upload/auth sessions and unreferenced storage objects older than 24 hours; active uploads and version references are protected |

Transfer states distinguish **uploading chunks**, **validating and publishing**, and **published / conflict copy saved**. The app does not claim that other devices have synchronized.

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

## Verification

```bash
# Transaction, fault-injection, permission, and concurrency tests (H2)
mvn -f backend/pom.xml test

# Type checking and production build
cd frontend
npm ci
npm run build

# From the repository root, exercise the running Compose stack
python3 scripts/smoke.py --url http://127.0.0.1:4173

# Browser regression tests against a running app
cd frontend
npx playwright install chromium
E2E_URL=http://127.0.0.1:4173 npm run test:e2e
```

HTTP and browser tests create isolated test accounts. See the [verification report](docs/verification.md) for observed results and limitations. The CI workflow is defined in `.github/workflows/ci.yml`; its presence does not imply a completed remote CI run.

## Repository

```text
backend/
  src/main/java/dev/filetrail/     # Auth, workspace, versions, uploads, storage, API, worker
  src/main/resources/db/migration/ # Flyway migrations
  src/test/                       # Integration and fault-injection tests
frontend/
  src/                            # React workspace and resumable transfer queue
  e2e/                            # Browser tests with English file and folder names
scripts/                          # Configuration, HTTP checks, restart checks, benchmark
docs/                            # Architecture, API, deployment, verification
compose.yaml                      # Complete local deployment
```

[Architecture](docs/architecture.md) · [API](docs/api.md) · [Deployment](docs/deployment.md) · [Verification](docs/verification.md) · [Roadmap](docs/roadmap.md)
