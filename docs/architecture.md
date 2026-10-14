# Architecture and consistency

## Scope

Stage one uses a modular monolith and a cleanup worker sharing the Java codebase. Object storage holds content; SQL owns accounts, directories, versions, upload state, shares, and events. Development mode substitutes H2 and local files without changing business logic.

Browser → same-origin proxy → API → PostgreSQL / private S3. Downloads stream through the API so storage URLs cannot bypass authorization.

## Data model

- `file_entry` is a stable identity. Names and parent folders can change.
- `file_version` is append-only, with increasing numbers per file and a `current_version` pointer.
- `content_object` references immutable bytes. Restoring history creates a new version that reuses the content reference.
- `upload_session` fixes the size, full SHA-256, chunk strategy, target, and base version. `(session_id, part_no)` uniquely identifies each acknowledged `upload_part`.
- `share_link` targets a version ID and stores only the SHA-256 digest of its random credential.
- `activity_event` describes operations. `change_event` is committed with publication as groundwork for future synchronization.

Device registration, local SQLite state, and a change-cursor API belong to stage two. Recording events alone does not implement synchronization.

## Upload state machine

`OPEN → PUBLISHED | CONFLICT | CANCELLED | EXPIRED`

Pause stops browser requests while leaving the session `OPEN`. Sessions expire after seven days. Once publication commits, replaying completion returns the same `result_file` and `result_version`.

1. Session creation uses a unique `(owner_id, request_key)`. Reusing the key with different parameters returns 409.
2. The server calculates expected chunk sizes and reads at most that size plus one byte. Incorrect SHA-256 values are rejected.
3. Completion reads chunks in order, checks every chunk and the full hash, and assembles a temporary file.
4. The final object is written first. One SQL transaction then records content, version, current pointer, activity, change event, and session result.
5. Missing chunks, corruption, storage errors, or a transaction rollback never expose an incomplete version. Corrupt stored chunks are identified by `partNo` for repair.

Final keys use `contents/{upload-session-id}`; chunks use `parts/{upload-session-id}/{index}-{sha256}`. Immutable session parameters make retries write identical bytes. A repeated chunk with the same hash can repair storage; a different hash cannot replace an acknowledged chunk.

## Concurrency and commit order

Every write first locks the owner's `app_user` row. Base-version checks and publication happen under that lock. Account-level serialization also works across API instances sharing PostgreSQL, at the cost of blocking other writes for that account during a large publication.

If two clients start from V1, the first can advance the original. The second sees a changed current version and publishes a separate entry with `conflict_of`. Updates competing with deletion and new uploads colliding with existing names also preserve a copy.

The account lock aligns per-account `change_event.seq` allocation with commit order, avoiding missed events from a smaller cursor committed later. Stage two still needs retention rules, snapshots, idempotent application, and full-scan recovery.

## Storage failures and cleanup

SQL and object storage do not share a transaction. A failure may leave an unreferenced object; it must never leave a visible version pointing to incomplete content.

The worker scans objects older than 24 hours, identifies their session, locks the account, and checks both content references and unexpired open uploads before deleting anything. This protects publication, retry after rollback, and concurrent cleanup.

Published chunks remain for at least 24 hours; historical final objects remain referenced. The MVP loads the object inventory into memory; larger deployments need paginated, bounded cleanup. Hard process termination can leave assembly files in the system temporary directory. Monitor temporary disk usage and configure OS cleanup.

## Security boundaries

- Private endpoints derive ownership from the authenticated cookie, never a submitted owner ID.
- Authentication and share credentials use 256-bit random values; only digests are stored. Auth sessions last at most seven days.
- Writes require `X-FileTrail: 1`; cross-origin CORS is disabled and `Sec-Fetch-Site: cross-site` is rejected. Keep the web app and API on one origin.
- BCrypt cost is 12. Passwords require at least ten characters and at most 72 UTF-8 bytes. Login and registration share a process-local limit of 20 attempts per minute per IP; public deployment needs gateway-level limits.
- Names reject path separators and control characters. Storage keys are server-generated.
- Downloads use attachment disposition, `application/octet-stream`, and `nosniff`; uploaded HTML/SVG is not executed inline.
- Every shared download checks expiration and revocation. Active streams and saved copies cannot be recalled.

## Unverified guarantees

Storage replication, regional disaster recovery, power-loss recovery, periodic historical-content scrubbing, malware scanning, and quotas are not implemented or verified. Storage durability depends on the provider. Local file storage is for development. Performance claims require measurements under stated conditions.
