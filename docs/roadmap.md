# Scope and roadmap

## Delivered web MVP

Accounts, directories, resumable uploads, immutable versions and restore, conflict copies, version-specific sharing, trash, activity, cleanup, local deployment, and backend/HTTP/browser test code are implemented.

This release does not complete the entire original plan. See the README limits and verification report. Activity primarily records completed operations; transfer failures appear in browser tasks, without a separate persistent server-side failure audit system.

## Improve stage one

- Server-side pagination, workspace-wide search, quotas, and long-running transfer cancellation.
- Asynchronous validation/publication with shorter database lock duration, task leases, replay, and recovery.
- Consistent operation-result queries and idempotency for share/folder creation.
- Recursive batch deletion/restoration, trash retention, and reference-safe permanent cleanup.
- Email verification, password reset, session management, gateway limits, and production dependency review.
- Larger-file and concurrency baselines with explicit client, API, database, storage, network, and hardware conditions.

## Stage two: Python sync CLI

### Define the protocol

1. Register devices and derive source identity from authentication.
2. Add paginated change cursors, retention, and expired-cursor responses.
3. Define a consistent remote snapshot and incremental catch-up protocol.
4. Specify deletion tombstones, path conflicts, renames, and concurrent writes.

### Implement the client

Persist remote IDs, local paths, last synchronized versions, SHA-256 values, pending operations, and cursors in SQLite. Use filesystem events for speed and periodic scans for recovery. Download to a temporary file, verify, then atomically replace the destination. Advance the cursor only after successful local application. Preserve conflicts between local edits and remote updates/deletions.

Local directory synchronization and multi-device offline recovery should only be claimed after implementation and verification.

## Portfolio demonstration

Use observed results from the verification report. Configuration limits are not benchmark results, and a web UI is not a synchronization client. Do not invent throughput, latency, or reliability figures.

Suggested demo: register → upload → interrupt/resume → update → restore history → race two clients → share a fixed version and revoke → recover from trash.
