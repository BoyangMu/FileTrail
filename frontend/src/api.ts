export type User = { id: string; email: string; display_name: string };
export type Entry = {
  id: string;
  name: string;
  kind: 'FILE' | 'FOLDER';
  parent_id: string | null;
  current_version: string | null;
  version_no: number | null;
  sha256: string | null;
  size: number;
  updated_at: number;
  trashed_at: number | null;
  conflict_of: string | null;
};
export type Version = {
  id: string;
  file_id: string;
  version_no: number;
  size: number;
  sha256: string;
  source: string;
  created_at: number;
  restored_from: string | null;
};
export type Upload = {
  id: string;
  name: string;
  size: number;
  sha256: string;
  state: string;
  part_size: number;
  part_count: number;
  parts: { part_no: number; sha256: string; size: number }[];
  result_file: string | null;
  result_version: string | null;
  created_at: number;
  expires_at: number;
};
export type Share = {
  id: string;
  name: string;
  version_no: number;
  expires_at: number;
  revoked_at: number | null;
  created_at: number;
  file_id: string;
  version_id: string;
};
export type Activity = {
  id: string;
  name: string;
  action: string;
  detail: string;
  created_at: number;
};
export type Stats = { files: number; bytes: number; versions: number; conflicts: number };
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public partNo?: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-FileTrail': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({
        message: 'The service is temporarily unavailable. Please try again.',
        code: 'NETWORK_ERROR',
      }));
    throw new ApiFailure(res.status, err.code, err.message, err.partNo);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
export function size(bytes: number) {
  if (bytes === 0) return '0 B';
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}
export function date(time: number) {
  return new Date(time).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
export function download(file: string, version: string) {
  const a = document.createElement('a');
  a.href = `/api/files/${file}/versions/${version}/download`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Render stable event codes in English, including events created before the UI language change.
export function activityDescription(event: Activity): string {
  const descriptions: Record<string, string> = {
    FOLDER_CREATED: 'Created a folder.',
    MOVED: 'Renamed or moved. File identity and version history are preserved.',
    TRASHED: 'Moved to trash. File contents and history are retained.',
    UNTRASHED: 'Restored from trash.',
    RESTORED: 'Created a new version from a historical version.',
    CONFLICT_RESOLVED: 'Kept both files and resolved the conflict.',
    SHARED: 'Created a read-only link to a specific version.',
    SHARE_REVOKED: 'Revoked the shared link. New access is blocked.',
    UPLOADED: 'Content verified. Version published.',
    CONFLICT: 'Saved a separate conflict copy. The original was preserved.',
  };
  return descriptions[event.action] ?? event.detail;
}
