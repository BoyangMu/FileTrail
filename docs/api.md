# HTTP API

Base path: `/api`. Request JSON uses camelCase; database-backed responses use snake_case. Private endpoints require the `ft_session` cookie. Every write requires `X-FileTrail: 1`. The same-origin web app does not manage bearer tokens.

Errors use `{"code":"CONFLICT","message":"Human-readable explanation"}`. Corrupt stored chunks also return `partNo`. Common statuses: 400 invalid input, 401 unauthenticated, 403 invalid request origin, 404 missing or not owned, 409 conflict, 410 expired/revoked, 422 checksum failure, 429 authentication rate limit, 503 storage unavailable.

## Accounts

| Method | Path             | Request / response                                                              |
| ------ | ---------------- | ------------------------------------------------------------------------------- |
| POST   | `/auth/register` | `{email,password,displayName}`; returns public account data and sets the cookie |
| POST   | `/auth/login`    | `{email,password}`                                                              |
| GET    | `/auth/me`       | Current account                                                                 |
| POST   | `/auth/logout`   | Revokes the session and clears the cookie                                       |
| GET    | `/health`        | Database connectivity; does not verify S3 reads/writes                          |

## Files

| Method | Path                                        | Request / response                                                                |
| ------ | ------------------------------------------- | --------------------------------------------------------------------------------- |
| GET    | `/stats`                                    | Active file count, current content bytes, version count, conflicts                |
| GET    | `/files?view=files&parent={id}`             | Views: files / recent / trash / conflicts; omit parent for root                   |
| GET    | `/folders`                                  | Active folders                                                                    |
| POST   | `/folders`                                  | `{name,parentId}`; null parent means root                                         |
| GET    | `/files/{id}`                               | Entry, current version, size                                                      |
| PATCH  | `/files/{id}`                               | `{name,parentId}`; provide both explicitly                                        |
| DELETE | `/files/{id}`                               | Move to trash; repeated deletion is a no-op                                       |
| POST   | `/files/{id}/untrash`                       | Restore to the original folder or root if unavailable; name collisions return 409 |
| GET    | `/files/{id}/versions`                      | Full version history                                                              |
| GET    | `/files/{id}/versions/{versionId}/download` | Streamed attachment with `X-Content-SHA256`                                       |
| POST   | `/files/{id}/restore`                       | `{versionId,baseVersion,requestKey}`; creates a version, supports request replay  |
| POST   | `/files/{id}/resolve`                       | Keep original and copy; clear the copy's conflict marker                          |

## Chunked uploads

`POST /uploads`:

```json
{
  "requestKey": "client-generated-uuid",
  "targetId": null,
  "parentId": null,
  "name": "report.pdf",
  "baseVersion": null,
  "size": 12345,
  "sha256": "64-lowercase-hex-characters",
  "partSize": 4194304,
  "source": "Web"
}
```

Updating a file requires both `targetId` and a `baseVersion` belonging to its history. Both are null for a new file. Session parameters are immutable.

- `GET /uploads`: latest 100 session summaries.
- `GET /uploads/{id}`: state and acknowledged `parts`. Resume by sending missing indices only.
- `PUT /uploads/{id}/parts/{index}`: zero-based index, binary body, `Content-Type: application/octet-stream`, and `X-Content-SHA256`. The last chunk may be smaller; empty files need no chunks.
- `POST /uploads/{id}/complete`: synchronous validation/publication; returns `PUBLISHED` or `CONFLICT` with `result_file` and `result_version`. A conflict means a complete copy was saved, not a failed upload.
- `DELETE /uploads/{id}`: cancel an open session. Published versions cannot be cancelled; move the file to trash instead.

After a completion timeout, query the session and retry completion on that same session. Do not create another session to retry publication. This protocol also applies after an API process restart.

## Sharing and activity

- `POST /files/{id}/shares`: `{versionId,days}`, with days from 1 to 30; returns `{id,token,path}`. The credential is returned only once.
- `GET /shares`: the owner's links and statuses, without credentials.
- `DELETE /shares/{id}`: revoke a link.
- `GET /public/shares/{token}`: public share metadata.
- `GET /public/shares/{token}/download`: public attachment download; validates access on every request.
- `GET /activity`: latest 200 events.

Folder/share creation does not yet have request-level idempotency. The UI prevents double-click submission, but clients should not blindly repeat share creation after an unknown result. Version publication and restore are the implemented idempotency boundaries.
