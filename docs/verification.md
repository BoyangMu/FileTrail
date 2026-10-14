# MVP verification record

Initial execution date: **2026-09-15**. These are observed local results, not planned capabilities.

## Environment

- Host: Apple M1 Max, 32 GiB RAM, macOS 26.6.2 arm64.
- Backend tests: Spring Boot 3.5.16, Maven 3.9.11, Java 25, in-memory H2, local object storage.
- Process restart checks: Java 19, disk-backed H2 with `WRITE_DELAY=0`, local storage, isolated temporary directories.
- Compose: Docker Engine 29.4.0, Java 21.0.12, PostgreSQL 17.11, MinIO S3, nginx, separate worker.
- Frontend: React, TypeScript, Vite 7.3.6; Playwright Chromium, desktop 1440×1000 and mobile 390×844.

## Passed checks

| Check                                                        | Observed result                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| `mvn test` / `mvn package`                                   | 13 backend integration tests; zero failures/errors              |
| Strict TypeScript checks and production build                | Passed                                                          |
| H2 / local storage HTTP acceptance                           | Passed                                                          |
| PostgreSQL / S3 / nginx HTTP acceptance                      | Passed                                                          |
| Development browser regression                               | 3 passed                                                        |
| Compose browser regression                                   | 3 passed                                                        |
| Forced API termination during upload                         | Acknowledged chunks survived; only remaining chunks were sent   |
| Forced termination after publication, then completion replay | Same version ID, one version, identical downloaded bytes        |
| Standalone worker                                            | Started without HTTP, connected to PostgreSQL, remained running |

### Backend coverage: 13 tests

1. Missing chunks cannot publish; invalid chunk checksums are rejected; repeated chunks do not duplicate records; resumed download matches byte-for-byte.
2. Session creation is idempotent; different parameters cannot reuse a request key; repeated completion creates one version.
3. Two concurrent updates produce one original update and one conflict copy; both hashes survive.
4. Restore creates a version; replay does not duplicate it; a stale base cannot overwrite the current version.
5. Cross-account access to files, history, downloads, deletion, and sessions is rejected; authentication and write-origin markers are required.
6. Shares remain tied to the selected historical version; expired/revoked links deny new downloads.
7. Move/rename preserves identity and history; updates competing with deletion preserve a copy.
8. Directory cycles, nonempty-folder deletion, and duplicate sibling names are rejected.
9. Stored chunk corruption and full-file hash mismatch prevent publication; repaired chunks allow retry.
10. SQL rollback after the final object write exposes no version; retry publishes correctly.
11. Injected storage write failure prevents publication and permits recovery.
12. Empty files publish; cancelled/expired sessions cannot publish.
13. Cleanup preserves historical references and active chunks while reclaiming cancelled/expired uploads and orphaned objects.

### Browser coverage: 3 tests

- Register → upload → new version → restore V3 → create/open share → revoke → rename → trash/restore.
- Interrupt chunk 1 of a three-chunk 9 MiB file, reload, reselect, and resume. Successful chunk indices are **`[0, 1, 2]`**, without resending chunk 0.
- Mobile registration, folder creation/navigation, and no horizontal page overflow.

Manual browser inspection also checked layout and real account state. The in-app browser's file chooser event timed out; repository Playwright tests exercised the full upload flow. Tool timeouts are not counted as product success.

## Issues found and fixed

- Direct field access through a Spring transaction proxy caused a null upload dependency; access now uses a method on the injected service.
- H2's delayed writes could lose an acknowledged session after immediate SIGKILL. Disk mode now uses `WRITE_DELAY=0`, and restart checks passed.
- Corrupt stored chunks need an explicit repair index. Responses include `partNo`; resume excludes that chunk from the acknowledged set.
- Cancellation racing publication must query the final state instead of reporting a published version as a cancellation failure.
- A running JAR must not be overwritten. Startup instructions require stopping the process before replacement.

## Initial measurements

See [performance-baseline.json](performance-baseline.json): random 16 MiB files, 4 MiB chunks, one benchmark request stream, three uploads/downloads through local Compose. **Browser acceptance tests ran concurrently, so the host was not isolated. These are development samples.**

Every download was checked against SHA-256. These samples do not establish maximum throughput, 4 GiB capacity, sustained stability, or production latency. The 18 latency samples mix session creation, chunk transfer, and completion; their percentiles are not production SLOs.

## Not verified or delivered

- Remote CI execution: a workflow exists, but no remote run is recorded.
- Public hosting, production domain, and TLS.
- 4 GiB load tests, sustained traffic, large directories, or large object inventories.
- Peak API memory, storage IOPS, or multi-device synchronization latency.
- Power loss, physical storage failure, backup restoration, regional recovery, or database failover.
- Cleanup correctness tests use local storage. The deployed worker connected to S3, but no 24-hour S3 expiration/fault drill was performed.
- Demonstration video and stage-two Python sync client.

## Reproduce

```bash
mvn -f backend/pom.xml test
python3 scripts/restart_check.py
python3 scripts/smoke.py --url http://127.0.0.1:4173
cd frontend
npm run build
E2E_URL=http://127.0.0.1:4173 npm run test:e2e
```

Generated test accounts and files are isolated from user-created workspaces.

## English UI and blue theme regression — 2026-09-16

- Translated application copy, API errors, and project documentation into English; dates use `en-US`. Existing user filenames remain unchanged.
- Applied blue (`#2563eb`) to primary actions, navigation, focus states, branding, and progress indicators; semantic warning/error colors remain distinct.
- Backend package: 13 tests passed, zero failures/errors. An initial sandboxed attempt could not initialize Mockito's JVM attachment; rerunning with attachment permitted passed.
- Rebuilt the local Compose deployment. Strict TypeScript checks and production asset compilation passed during the image build.
- All three Playwright tests passed against the updated Compose app, including checks for the document language and primary button color. Unicode filenames remain covered.
- Inspected desktop login/workspace and mobile screenshots. Browser checks confirmed no horizontal overflow at 390 px width.
