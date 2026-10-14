import { useEffect, useRef, useState } from 'react';
import { createSHA256 } from 'hash-wasm';
import { api, ApiFailure, Entry, Upload } from './api';

export type Job = {
  key: string;
  uploadId?: string;
  name: string;
  size: number;
  parentId: string | null;
  targetId: string | null;
  baseVersion: string | null;
  sha256?: string;
  repairPart?: number;
  status:
    | 'queued'
    | 'hashing'
    | 'uploading'
    | 'publishing'
    | 'paused'
    | 'failed'
    | 'published'
    | 'conflict'
    | 'cancelled';
  progress: number;
  error?: string;
};
const terminal = (status: Job['status']) => ['published', 'conflict', 'cancelled'].includes(status);
const PART = 4 * 1024 * 1024;
export function useTransfers(userId: string, onPublish: () => void) {
  const storageKey = 'filetrail.transfers.' + userId;
  const [jobs, setJobs] = useState<Job[]>(() => {
    try {
      return (JSON.parse(localStorage.getItem(storageKey) || '[]') as Job[]).map((j) => ({
        ...j,
        status: terminal(j.status) ? j.status : 'paused',
        error: terminal(j.status) ? undefined : 'Select the original file again to resume.',
      }));
    } catch {
      return [];
    }
  });
  const files = useRef(new Map<string, File>());
  const controls = useRef(new Map<string, AbortController>());
  const busy = useRef(false);
  const current = useRef(jobs);
  current.current = jobs;
  const finished = useRef(onPublish);
  finished.current = onPublish;
  const patch = (key: string, values: Partial<Job>) =>
    setJobs((all) => all.map((j) => (j.key === key ? { ...j, ...values } : j)));
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(jobs));
  }, [jobs, storageKey]);
  useEffect(
    () => () => {
      controls.current.forEach((c) => c.abort());
    },
    [],
  );
  useEffect(() => {
    if (busy.current) return;
    const job = jobs.find((j) => j.status === 'queued');
    if (!job) return;
    busy.current = true;
    const controller = new AbortController();
    controls.current.set(job.key, controller);
    void run(job, controller.signal).finally(() => {
      busy.current = false;
      controls.current.delete(job.key);
      setJobs((j) => [...j]);
    });
  }, [jobs]);
  async function run(job: Job, signal: AbortSignal) {
    try {
      const file = files.current.get(job.key);
      if (!file) {
        patch(job.key, {
          status: 'paused',
          error: 'Select the original file again. Only missing parts will be uploaded.',
        });
        return;
      }
      if (file.size > 4 * 1024 * 1024 * 1024)
        throw new Error('The file size limit is 4 GiB. Please choose a smaller file.');
      patch(job.key, { status: 'hashing', error: undefined });
      const hasher = await createSHA256();
      hasher.init();
      for (let offset = 0; offset < file.size; offset += PART) {
        signal.throwIfAborted();
        hasher.update(new Uint8Array(await file.slice(offset, offset + PART).arrayBuffer()));
        patch(job.key, {
          progress: Math.round((Math.min(offset + PART, file.size) / Math.max(file.size, 1)) * 100),
        });
      }
      const sha256 = hasher.digest('hex');
      signal.throwIfAborted();
      if (job.sha256 && job.sha256 !== sha256)
        throw new Error(
          'This file has changed. Select the original file, or cancel and start a new upload.',
        );
      patch(job.key, { sha256, progress: 0 });
      const session = job.uploadId
        ? await api<Upload>('/uploads/' + job.uploadId, 'GET', undefined, signal)
        : await api<Upload>(
            '/uploads',
            'POST',
            {
              requestKey: job.key,
              targetId: job.targetId,
              parentId: job.parentId,
              name: job.name,
              baseVersion: job.baseVersion,
              size: file.size,
              sha256,
              partSize: PART,
              source: 'Web',
            },
            signal,
          );
      patch(job.key, { uploadId: session.id });
      if (session.state === 'PUBLISHED' || session.state === 'CONFLICT') {
        patch(job.key, {
          status: session.state === 'CONFLICT' ? 'conflict' : 'published',
          progress: 100,
        });
        finished.current();
        return;
      }
      if (session.state !== 'OPEN')
        throw new Error('This upload was canceled or expired. Start a new upload.');
      const goodParts = session.parts.filter((p) => p.part_no !== job.repairPart);
      const present = new Set(goodParts.map((p) => p.part_no));
      let received = goodParts.reduce((a, p) => a + p.size, 0);
      patch(job.key, {
        status: 'uploading',
        progress: Math.round((received / Math.max(file.size, 1)) * 100),
      });
      for (let index = 0; index < session.part_count; index++) {
        signal.throwIfAborted();
        if (present.has(index)) continue;
        const chunk = await file
          .slice(index * session.part_size, (index + 1) * session.part_size)
          .arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', chunk)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const res = await fetch(`/api/uploads/${session.id}/parts/${index}`, {
          method: 'PUT',
          headers: {
            'X-FileTrail': '1',
            'Content-Type': 'application/octet-stream',
            'X-Content-SHA256': hash,
          },
          body: chunk,
          signal,
        });
        if (!res.ok) {
          const body = await res.json();
          throw new ApiFailure(res.status, body.code, body.message);
        }
        received += chunk.byteLength;
        patch(job.key, { progress: Math.round((received / Math.max(file.size, 1)) * 100) });
      }
      signal.throwIfAborted();
      patch(job.key, { status: 'publishing', progress: 100 });
      const result = await api<Upload>(
        '/uploads/' + session.id + '/complete',
        'POST',
        undefined,
        signal,
      );
      patch(job.key, {
        status: result.state === 'CONFLICT' ? 'conflict' : 'published',
        progress: 100,
      });
      files.current.delete(job.key);
      finished.current();
    } catch (error) {
      if (signal.aborted) return;
      patch(job.key, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Connection interrupted. Please try again.',
        repairPart: error instanceof ApiFailure ? error.partNo : job.repairPart,
      });
    }
  }
  function add(selected: File[], parentId: string | null, target?: Entry) {
    const next = selected.map((file) => {
      const key = crypto.randomUUID();
      files.current.set(key, file);
      return {
        key,
        name: target?.name ?? file.name,
        size: file.size,
        parentId,
        targetId: target?.id ?? null,
        baseVersion: target?.current_version ?? null,
        status: 'queued' as const,
        progress: 0,
      };
    });
    setJobs((j) => [...next, ...j]);
  }
  function pause(key: string) {
    controls.current.get(key)?.abort();
    patch(key, { status: 'paused', error: undefined });
  }
  function resume(key: string, file?: File) {
    if (file) files.current.set(key, file);
    if (!files.current.has(key)) return false;
    patch(key, { status: 'queued', error: undefined });
    return true;
  }
  async function cancel(job: Job) {
    controls.current.get(job.key)?.abort();
    patch(job.key, { status: 'paused' });
    try {
      if (job.uploadId) await api('/uploads/' + job.uploadId, 'DELETE');
      patch(job.key, { status: 'cancelled', error: undefined });
      files.current.delete(job.key);
    } catch (e) {
      if (job.uploadId && e instanceof ApiFailure && e.status === 409) {
        try {
          const result = await api<Upload>('/uploads/' + job.uploadId);
          if (['PUBLISHED', 'CONFLICT'].includes(result.state)) {
            patch(job.key, {
              status: result.state === 'CONFLICT' ? 'conflict' : 'published',
              progress: 100,
              error: undefined,
            });
            finished.current();
            return;
          }
        } catch {
          /* Preserve original failure for retry. */
        }
      }
      patch(job.key, {
        status: 'failed',
        error: e instanceof Error ? e.message : 'Could not cancel the upload. Please try again.',
      });
      finished.current();
    }
  }
  return {
    jobs,
    add,
    pause,
    resume,
    cancel,
    clear: () => setJobs((j) => j.filter((x) => !terminal(x.status))),
    active: jobs.filter((j) => !terminal(j.status)).length,
  };
}
