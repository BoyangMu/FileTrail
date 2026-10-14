# Setup and deployment

## Local Compose topology

`web:80 → api:8080 → postgres:5432 / minio:9000`. The worker shares the API image and database, runs without HTTP, and periodically cleans expired uploads and orphaned objects.

Host bindings are loopback-only: web 4173, API 8081, MinIO console 9001. Named volumes survive ordinary `compose down`.

`python3 scripts/configure.py` generates database/storage credentials using OS randomness and writes `.env` with mode 0600. Existing configuration is never overwritten. `.env.example` describes fields rather than supplying production defaults.

## Configuration

| Variable                                             | Purpose                                                  |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD` | PostgreSQL JDBC URL and credentials                      |
| `STORAGE=local\|s3`                                  | Content storage adapter                                  |
| `DATA_DIR`                                           | Local content directory; separate from the database path |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`              | S3 service settings                                      |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY`                     | S3 credentials                                           |
| `SECURE_COOKIE`                                      | Set true behind HTTPS                                    |
| `WORKER_ENABLED`                                     | Enable scheduled cleanup                                 |
| `SPRING_MAIN_WEB_APPLICATION_TYPE=none`              | Run the worker without HTTP                              |
| `CLEANUP_INTERVAL_MS`                                | Cleanup interval; default one hour                       |
| `CLEANUP_INITIAL_DELAY_MS`                           | Initial delay; default one minute                        |
| `WEB_PORT`                                           | Compose host web port; default 4173                      |

## Before public deployment

The repository provides a runnable local deployment; it does not provision a public domain or hosting.

1. Use maintained PostgreSQL and S3 services. The Compose MinIO Community image is an isolated local compatibility test service, not a production storage recommendation.
2. Serve the app and `/api` from one origin, terminate TLS at a trusted proxy, and set `SECURE_COOKIE=true`. Expose only HTTPS publicly.
3. Scope storage permissions to the application bucket. Local Compose uses administrator credentials to simplify initialization.
4. Configure database backups and restore drills, object protection, disk/capacity alerts, centralized logs, and gateway rate limits. Account quotas are not implemented.
5. Chunk request bodies are limited to 5 MiB. Publication is synchronous with a 900-second proxy read timeout. Query/retry the same session after a timeout.
6. Reserve temporary disk space equal to each file being assembled. The API allows 4 GiB files; that size has not been load-tested.
7. Redact sensitive logs. Share credentials appear in paths; local nginx access logging is disabled. External proxies must not log complete share URLs.

Backups must cover both metadata and content. A database restored to an earlier point must still have access to every referenced object. Historical objects are retained in this release.

## Troubleshooting

- App unavailable: inspect `docker compose ps`, `docker compose logs api`, and `/api/health`.
- S3 unavailable: health checks verify SQL only. Run `scripts/smoke.py` to exercise real file reads/writes.
- 409: inspect name collisions, base versions, reused request keys, nonempty folders, or directory cycles.
- 422: re-upload the corrupt `partNo`; if the full hash differs, cancel and create a new session.
- 410: the upload expired or the share is invalid.
- Public image pull stalls: inspect Docker credentials and network state. Do not delete user credentials or modify unrelated containers.
- Update: run `docker compose up --build -d`. For local JAR mode, stop the process before replacing its JAR.

## Restart recovery

After building the JAR:

```bash
python3 scripts/restart_check.py
```

The script starts its own temporary service. It tests SIGKILL during an upload, resumption after restart, SIGKILL after publication, and completion replay. It does not take over an existing server. Process-crash recovery is distinct from power-loss or cross-storage disaster recovery.
