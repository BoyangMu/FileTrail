import { useCallback, useEffect, useRef, useState, FormEvent, ReactNode } from 'react';
import {
  Activity as ActivityIcon,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock3,
  Cloud,
  CloudUpload,
  Copy,
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  History,
  LayoutGrid,
  Link2,
  List,
  LoaderCircle,
  LogOut,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Search,
  ShieldCheck,
  TriangleAlert,
  Trash2,
  X,
} from 'lucide-react';
import {
  api,
  activityDescription,
  ApiFailure,
  Activity,
  date,
  download,
  Entry,
  Share,
  size,
  Stats,
  User,
  Version,
} from './api';
import { Job, useTransfers } from './transfers';

type View = 'files' | 'recent' | 'shares' | 'conflicts' | 'trash' | 'activity' | 'transfers';
const titles: Record<View, string> = {
  files: 'My files',
  recent: 'Recent',
  shares: 'Shared links',
  conflicts: 'Conflicts',
  trash: 'Trash',
  activity: 'Activity',
  transfers: 'Transfers',
};
const descriptions: Record<View, string> = {
  files: 'A home for your files. A history for every change.',
  recent: 'Pick up where you left off with your latest files.',
  shares: 'Share a specific version. Stay in control of access.',
  conflicts: 'Every change matters. Review both copies and choose what to keep.',
  trash: 'A second chance for deleted files. Your history stays intact.',
  activity: 'Follow every upload, restore, and share.',
  transfers: 'Connections come and go. Your progress stays.',
};
const labels: Record<Job['status'], string> = {
  queued: 'Queued',
  hashing: 'Calculating checksum',
  uploading: 'Uploading parts',
  publishing: 'Verifying & publishing',
  paused: 'Paused',
  failed: 'Retry needed',
  published: 'Version published',
  conflict: 'Conflict copy saved',
  cancelled: 'Canceled',
};
function Glyph({
  name,
  folder = false,
  large = false,
}: {
  name: string;
  folder?: boolean;
  large?: boolean;
}) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const [Icon, color] = folder
    ? [Folder, 'amber']
    : ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'].includes(ext)
      ? [FileImage, 'purple']
      : ['zip', 'gz', 'rar', 'tar'].includes(ext)
        ? [FileArchive, 'orange']
        : ['ts', 'js', 'py', 'java', 'json', 'html', 'css'].includes(ext)
          ? [FileCode2, 'blue']
          : ['pdf', 'txt', 'md', 'doc', 'docx'].includes(ext)
            ? [FileText, 'blue']
            : [File, 'gray'];
  return (
    <span className={`file-glyph ${color} ${large ? 'large' : ''}`}>
      <Icon size={large ? 34 : 22} strokeWidth={1.65} />
    </span>
  );
}
function Logo() {
  return (
    <div className="logo">
      <span className="brand-mark">
        <span />
        <span />
        <span />
      </span>
      filetrail<span className="brand-dot">.</span>
    </div>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>('input,button,select')?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const focus = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,textarea,a[href]',
          ) ?? []),
        ];
        if (!focus.length) return;
        const first = focus[0],
          last = focus[focus.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" onClick={close} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true),
    [connection, setConnection] = useState('');
  useEffect(() => {
    api<User>('/auth/me')
      .then(setUser)
      .catch((e) => {
        if (!(e instanceof ApiFailure && e.status === 401))
          setConnection('Unable to connect to FileTrail. Please try again in a moment.');
      })
      .finally(() => setChecking(false));
  }, []);
  if (location.pathname.startsWith('/s/'))
    return <Shared token={location.pathname.split('/')[2]} />;
  if (checking)
    return (
      <div className="loading-screen">
        <Logo />
        <LoaderCircle className="spin" />
        <p>Opening your workspace…</p>
      </div>
    );
  return user ? (
    <Workspace key={user.id} user={user} logout={() => setUser(null)} />
  ) : (
    <Auth success={setUser} connection={connection} />
  );
}
function Auth({ success, connection }: { success: (u: User) => void; connection: string }) {
  const [register, setRegister] = useState(false),
    [error, setError] = useState(connection),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(e.currentTarget);
    try {
      success(
        await api<User>(
          '/auth/' + (register ? 'register' : 'login'),
          'POST',
          Object.fromEntries(form),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <Logo />
        <div className="story-main">
          <div className="eyebrow">
            <span /> YOUR FILES. EVERY CHAPTER.
          </div>
          <h1>
            Every file.
            <br />
            Every version<span>.</span>
          </h1>
          <p>
            Keep your ideas. Keep your history.
            <br />
            From your first upload to your next fresh start.
          </p>
          <div className="story-illustration">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="floating-file back">
              <FileText size={38} />
              <span>Report · v1</span>
              <small>Previous version saved</small>
            </div>
            <div className="floating-file front">
              <span className="file-glyph blue large">
                <FileText size={34} />
              </span>
              <div>
                <strong>Project report.pdf</strong>
                <small>Version 3 · Current</small>
              </div>
              <span className="verified">
                <Check size={13} /> Integrity verified
              </span>
            </div>
            <div className="floating-check">
              <ShieldCheck size={21} /> Every change, accounted for
            </div>
          </div>
          <div className="story-benefits">
            <span>
              <CloudUpload size={17} /> Resumable uploads
            </span>
            <span>
              <History size={17} /> Version history
            </span>
            <span>
              <Link2 size={17} /> Secure sharing
            </span>
          </div>
        </div>
        <div className="story-footer">
          FILETRAIL / YOUR PERSONAL FILE WORKSPACE <span>01 — WEB EDITION</span>
        </div>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <span className="tiny-label">YOUR FILES, ALL TOGETHER</span>
          <h2>{register ? 'Create your workspace' : 'Welcome back'}</h2>
          <p>
            {register
              ? 'One workspace for the files and versions that matter.'
              : 'Sign in to FileTrail and pick up where you left off.'}
          </p>
          <form onSubmit={submit}>
            {register && (
              <label>
                Full name
                <input
                  name="displayName"
                  placeholder="Your name"
                  required
                  maxLength={100}
                  autoComplete="name"
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                name="email"
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                placeholder="At least 10 characters"
                required
                minLength={10}
                autoComplete={register ? 'new-password' : 'current-password'}
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary full" disabled={busy}>
              {busy ? <LoaderCircle size={18} className="spin" /> : null}
              {register ? 'Create account' : 'Sign in'}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="auth-switch">
            {register ? 'Already have an account?' : 'New to FileTrail?'}{' '}
            <button
              onClick={() => {
                setRegister(!register);
                setError('');
              }}
            >
              {register ? 'Sign in' : 'Create account'}
            </button>
          </p>
          <div className="privacy-note">
            <ShieldCheck size={16} />
            <span>
              Your workspace. Your files.
              <br />
              Every request is checked for authorized access.
            </span>
          </div>
        </div>
        <span className="auth-version">FILETRAIL V0.1 · WEB EDITION</span>
      </section>
    </div>
  );
}
function Workspace({ user, logout }: { user: User; logout: () => void }) {
  const [view, setView] = useState<View>('files'),
    [path, setPath] = useState<{ id: string; name: string }[]>([]),
    [entries, setEntries] = useState<Entry[]>([]),
    [folders, setFolders] = useState<{ id: string; name: string; parent_id: string | null }[]>([]),
    [stats, setStats] = useState<Stats>({ files: 0, bytes: 0, versions: 0, conflicts: 0 }),
    [shares, setShares] = useState<Share[]>([]),
    [activity, setActivity] = useState<Activity[]>([]);
  const [selected, setSelected] = useState<Entry | null>(null),
    [versions, setVersions] = useState<Version[]>([]),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState('updated'),
    [layout, setLayout] = useState<'list' | 'grid'>('list'),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [drag, setDrag] = useState(false),
    [checked, setChecked] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<
      'folder' | 'rename' | 'move' | 'trash' | 'share' | 'restore' | null
    >(null),
    [restoreVersion, setRestoreVersion] = useState<Version | null>(null),
    [shareVersion, setShareVersion] = useState<string | null>(null),
    [newLink, setNewLink] = useState(''),
    [modalError, setModalError] = useState('');
  const restoreKey = useRef(crypto.randomUUID());
  const refreshController = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null),
    resumeInput = useRef<HTMLInputElement>(null),
    uploadTarget = useRef<Entry | undefined>(undefined),
    resumeKey = useRef('');
  const parent = path.at(-1)?.id ?? null;
  const refresh = useCallback(async () => {
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    setError('');
    try {
      const [s, f] = await Promise.all([
        api<Stats>('/stats', 'GET', undefined, controller.signal),
        api<typeof folders>('/folders', 'GET', undefined, controller.signal),
      ]);
      setStats(s);
      setFolders(f);
      if (['files', 'recent', 'trash', 'conflicts'].includes(view))
        setEntries(
          await api<Entry[]>(
            `/files?view=${view}${parent && view === 'files' ? '&parent=' + parent : ''}`,
            'GET',
            undefined,
            controller.signal,
          ),
        );
      if (view === 'shares')
        setShares(await api<Share[]>('/shares', 'GET', undefined, controller.signal));
      if (view === 'activity')
        setActivity(await api<Activity[]>('/activity', 'GET', undefined, controller.signal));
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof ApiFailure && e.status === 401) logout();
      else setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [view, parent]);
  const transfer = useTransfers(user.id, () => {
    void refresh();
    setToast('Upload confirmed. Find your file in My files or review it in Conflicts.');
  });
  useEffect(() => {
    setLoading(true);
    setSelected(null);
    setChecked([]);
    setQuery('');
    void refresh();
    return () => refreshController.current?.abort();
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!selected || selected.kind === 'FOLDER') {
      setVersions([]);
      return;
    }
    const controller = new AbortController();
    setVersions([]);
    api<Version[]>(`/files/${selected.id}/versions`, 'GET', undefined, controller.signal)
      .then(setVersions)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [selected]);
  function navigate(next: View) {
    setView(next);
    setPath([]);
  }
  function openFile(f: Entry) {
    if (f.kind === 'FOLDER' && view !== 'trash') {
      setView('files');
      setPath((p) => [...p, { id: f.id, name: f.name }]);
    } else setSelected(f);
  }
  function showModal(type: typeof modal) {
    if (type === 'restore') restoreKey.current = crypto.randomUUID();
    setModalError('');
    setNewLink('');
    setModal(type);
  }
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setModalError('');
    try {
      await fn();
      setModal(null);
      setSelected(null);
      setChecked([]);
      setToast(message);
      await refresh();
    } catch (e) {
      setModalError((e as Error).message);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function chooseUpload(target?: Entry) {
    uploadTarget.current = target;
    if (input.current) {
      input.current.multiple = !target;
      input.current.click();
    }
  }
  const filtered = entries
    .filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'FOLDER' ? -1 : 1;
      return sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'size'
          ? b.size - a.size
          : b.updated_at - a.updated_at;
    });
  const allChecked = filtered.length > 0 && filtered.every((f) => checked.includes(f.id));
  const fileViews = ['files', 'recent', 'trash', 'conflicts'].includes(view);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <div className="workspace-switch">
          <span className="workspace-avatar">{user.display_name.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>My workspace</strong>
            <small>Personal account</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <span className="nav-label">Workspace</span>
        <nav>
          {(
            [
              ['files', Folder],
              ['recent', Clock3],
              ['shares', Link2],
              ['conflicts', History],
            ] as const
          ).map(([id, Icon]) => (
            <button
              key={id}
              aria-label={titles[id]}
              className={view === id ? 'nav-item active' : 'nav-item'}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              <span>{titles[id]}</span>
              {id === 'conflicts' && stats.conflicts > 0 && (
                <b className="nav-count">{stats.conflicts}</b>
              )}
              {id === 'files' && <span className="active-dot" />}
            </button>
          ))}
        </nav>
        <span className="nav-label secondary-label">MANAGE</span>
        <nav>
          {(
            [
              ['transfers', ArrowDownToLine],
              ['activity', ActivityIcon],
              ['trash', Trash2],
            ] as const
          ).map(([id, Icon]) => (
            <button
              key={id}
              aria-label={titles[id]}
              className={view === id ? 'nav-item active' : 'nav-item'}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              <span>{titles[id]}</span>
              {id === 'transfers' && transfer.active > 0 && (
                <b className="nav-count">{transfer.active}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="storage-card">
            <div>
              <Cloud size={18} />
              <strong>Storage in use</strong>
            </div>
            <b>{size(stats.bytes)}</b>
            <span>
              {stats.files} {stats.files === 1 ? 'file' : 'files'} · {stats.versions}{' '}
              {stats.versions === 1 ? 'version' : 'versions'}
            </span>
            <div className="storage-line" />
            <small>
              <ShieldCheck size={13} /> Your files and history, preserved
            </small>
          </div>
          <button
            className="account"
            onClick={() =>
              void action(async () => {
                await api('/auth/logout', 'POST');
                logout();
              }, 'Signed out')
            }
            title="Sign out"
          >
            <span className="user-avatar">{user.display_name.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{user.display_name}</strong>
              <small>{user.email}</small>
            </div>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{titles[view]}</strong>
          </div>
          <div className="topbar-right">
            <span className="edition">
              <span /> WEB EDITION · V0.1
            </span>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              title="View transfers"
              onClick={() => navigate('transfers')}
            >
              <CloudUpload size={20} />
              {transfer.active > 0 && <i className="notification-dot" />}
            </button>
            <span className="user-avatar small">{user.display_name.slice(0, 1).toUpperCase()}</span>
          </div>
        </header>
        <main
          className="main-content"
          onDragOver={(e) => {
            e.preventDefault();
            if (view === 'files') setDrag(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (view === 'files') {
              transfer.add([...e.dataTransfer.files], parent);
              setToast('Added to the upload queue.');
            }
          }}
        >
          <div className="page-heading">
            <div>
              <span className="eyebrow muted">YOUR PERSONAL CLOUD</span>
              <h1>
                {path.length && view === 'files' ? path.at(-1)?.name : titles[view]}
                <span className="heading-period">.</span>
              </h1>
              <p>{descriptions[view]}</p>
            </div>
            <div className="heading-actions">
              {view === 'files' && (
                <button className="secondary" onClick={() => showModal('folder')}>
                  <FolderPlus size={17} />
                  New folder
                </button>
              )}
              {['files', 'recent'].includes(view) && (
                <button className="primary" onClick={() => chooseUpload()}>
                  <Plus size={18} />
                  Upload files
                </button>
              )}
              {view === 'transfers' && (
                <button className="secondary" onClick={transfer.clear}>
                  <CheckCheck size={17} />
                  Clear completed
                </button>
              )}
            </div>
          </div>
          {view === 'files' && path.length === 0 && (
            <section className="overview">
              <div className="overview-intro">
                <span className="overview-icon">
                  <ShieldCheck size={25} />
                </span>
                <div>
                  <strong>A little peace of mind for every file.</strong>
                  <p>Keep your work safe. Find your way back to any version.</p>
                </div>
                <span className="overview-line" />
              </div>
              <div className="overview-number">
                <span>Total files</span>
                <strong>{stats.files.toLocaleString()}</strong>
              </div>
              <div className="overview-number">
                <span>Saved versions</span>
                <strong>{stats.versions.toLocaleString()}</strong>
              </div>
              <div className="overview-number">
                <span>Current file size</span>
                <strong className="size-number">{size(stats.bytes)}</strong>
              </div>
            </section>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <TriangleAlert size={18} />
              <span>{error}</span>
              <button onClick={() => void refresh()}>Retry</button>
              <button
                className="icon-button"
                onClick={() => setError('')}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view === 'conflicts' && (
            <div className="info-banner amber-banner">
              <TriangleAlert size={20} />
              <p>
                Your original file is safe. Download both copies to compare them, keep both, or
                merge your changes and upload a new version.
              </p>
            </div>
          )}
          {view === 'trash' && (
            <div className="info-banner">
              <History size={19} />
              <p>
                Files and version history stay in Trash until restored. Empty a folder before moving
                it to Trash.
              </p>
            </div>
          )}
          {fileViews && (
            <section className={`files-card ${selected ? 'with-details' : ''}`}>
              <div className="file-area">
                <div className="files-toolbar">
                  <div className="folder-crumbs">
                    <button
                      onClick={() => {
                        setPath([]);
                        setView('files');
                      }}
                    >
                      <HardDrive size={16} />
                      {view === 'files' ? 'All files' : titles[view]}
                    </button>
                    {view === 'files' &&
                      path.map((p, i) => (
                        <span key={p.id}>
                          <ChevronRight size={14} />
                          <button onClick={() => setPath(path.slice(0, i + 1))}>{p.name}</button>
                        </span>
                      ))}
                    <span className="count-label">{filtered.length}</span>
                  </div>
                  <div className="list-controls">
                    <div className="search-field">
                      <Search size={16} />
                      <input
                        aria-label="Search files"
                        placeholder="Search this folder…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      {query && (
                        <button
                          className="icon-button"
                          onClick={() => setQuery('')}
                          aria-label="Clear search"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                    <select
                      className="sort-select"
                      aria-label="Sort by"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="updated">Recent</option>
                      <option value="name">Name</option>
                      <option value="size">File size</option>
                    </select>
                    <div className="view-toggle">
                      <button
                        className={layout === 'list' ? 'selected' : ''}
                        aria-label="List view"
                        onClick={() => setLayout('list')}
                      >
                        <List size={17} />
                      </button>
                      <button
                        className={layout === 'grid' ? 'selected' : ''}
                        aria-label="Grid view"
                        onClick={() => setLayout('grid')}
                      >
                        <LayoutGrid size={16} />
                      </button>
                    </div>
                  </div>
                </div>
                {checked.length > 0 && (
                  <div className="selection-bar">
                    <span>Selected {checked.length} items</span>
                    <button onClick={() => setChecked([])}>Clear selection</button>
                    {view !== 'trash' && (
                      <button className="danger-text" onClick={() => showModal('trash')}>
                        <Trash2 size={14} />
                        Move to trash
                      </button>
                    )}
                  </div>
                )}
                {loading ? (
                  <div className="empty-state">
                    <LoaderCircle className="spin" />
                    <p>Loading your files…</p>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-art">
                      <div />
                      <Folder size={50} strokeWidth={1.1} />
                      <span>
                        <Plus size={16} />
                      </span>
                    </div>
                    <h3>
                      {query
                        ? 'No matching files'
                        : view === 'trash'
                          ? 'Your trash is empty'
                          : view === 'conflicts'
                            ? 'All changes, accounted for'
                            : view === 'recent'
                              ? 'Nothing here yet'
                              : 'Make room for your next big idea'}
                    </h3>
                    <p>
                      {query
                        ? 'Try a different search.'
                        : view === 'files'
                          ? 'Drop files here, or choose a file to get started.'
                          : view === 'conflicts'
                            ? 'You have no conflicts to resolve.'
                            : 'Your latest file activity will appear here.'}
                    </p>
                    {view === 'files' && !query && (
                      <button className="primary" onClick={() => chooseUpload()}>
                        <CloudUpload size={17} />
                        Upload your first file
                      </button>
                    )}
                    <span className="empty-caption">
                      Resumable uploads · Verified integrity · Version history
                    </span>
                  </div>
                ) : layout === 'list' ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th className="check-cell">
                            <input
                              type="checkbox"
                              aria-label="Select all"
                              checked={allChecked}
                              onChange={() =>
                                setChecked(allChecked ? [] : filtered.map((f) => f.id))
                              }
                            />
                          </th>
                          <th>Name</th>
                          <th>Size</th>
                          <th>
                            Recent
                            <ArrowDown size={12} />
                          </th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((f) => (
                          <tr
                            key={f.id}
                            className={selected?.id === f.id ? 'row-selected' : ''}
                            onClick={() => setSelected(f)}
                            onDoubleClick={() => openFile(f)}
                          >
                            <td className="check-cell" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                aria-label={'Select ' + f.name}
                                checked={checked.includes(f.id)}
                                onChange={() =>
                                  setChecked((c) =>
                                    c.includes(f.id) ? c.filter((id) => id !== f.id) : [...c, f.id],
                                  )
                                }
                              />
                            </td>
                            <td>
                              <button
                                className="file-name"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openFile(f);
                                }}
                              >
                                <Glyph name={f.name} folder={f.kind === 'FOLDER'} />
                                <span>
                                  <strong>{f.name}</strong>
                                  <small>
                                    {f.kind === 'FOLDER'
                                      ? 'Folder'
                                      : `Version ${f.version_no ?? 1}`}
                                  </small>
                                </span>
                              </button>
                            </td>
                            <td className="secondary-cell">
                              {f.kind === 'FOLDER' ? '—' : size(f.size)}
                            </td>
                            <td className="secondary-cell date-cell">{date(f.updated_at)}</td>
                            <td>
                              <span className={`status-badge ${f.conflict_of ? 'warning' : ''}`}>
                                {f.conflict_of ? (
                                  <TriangleAlert size={12} />
                                ) : f.trashed_at ? (
                                  <Trash2 size={12} />
                                ) : (
                                  <Check size={12} />
                                )}{' '}
                                {f.conflict_of
                                  ? 'Needs review'
                                  : f.trashed_at
                                    ? 'Deleted'
                                    : 'Saved'}
                              </span>
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={'View ' + f.name + ' details'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelected(f);
                                }}
                              >
                                <MoreHorizontal size={19} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="file-grid">
                    {filtered.map((f) => (
                      <button
                        key={f.id}
                        className={`grid-file ${selected?.id === f.id ? 'chosen' : ''}`}
                        onClick={() => setSelected(f)}
                        onDoubleClick={() => openFile(f)}
                      >
                        <div>
                          <Glyph name={f.name} folder={f.kind === 'FOLDER'} large />
                          {f.conflict_of ? (
                            <TriangleAlert size={16} className="orange-text" />
                          ) : (
                            <MoreHorizontal size={19} />
                          )}
                        </div>
                        <strong>{f.name}</strong>
                        <span>
                          {f.kind === 'FOLDER' ? 'Folder' : size(f.size)}
                          <small>{f.kind === 'FILE' ? `V${f.version_no}` : ''}</small>
                        </span>
                        <small>{date(f.updated_at)}</small>
                      </button>
                    ))}
                  </div>
                )}
                <div className="files-footer">
                  <span>
                    <ShieldCheck size={13} />
                    Verified with SHA-256 before publishing
                  </span>
                  <span>
                    {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
              </div>
              {selected && (
                <aside className="detail-panel">
                  <div className="detail-top">
                    <strong>File details</strong>
                    <button
                      className="icon-button"
                      onClick={() => setSelected(null)}
                      aria-label="Close details"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="detail-hero">
                    <Glyph name={selected.name} folder={selected.kind === 'FOLDER'} large />
                    <h3>{selected.name}</h3>
                    <span>
                      {selected.kind === 'FOLDER' ? 'Folder' : size(selected.size)} ·{' '}
                      {selected.kind === 'FILE'
                        ? `Current version V${selected.version_no}`
                        : 'Folder'}
                    </span>
                  </div>
                  <div className="detail-actions">
                    {selected.trashed_at ? (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          void action(
                            () => api('/files/' + selected.id + '/untrash', 'POST'),
                            'File restored.',
                          )
                        }
                      >
                        <History size={16} />
                        Restore file
                      </button>
                    ) : (
                      <>
                        {selected.kind === 'FILE' && (
                          <>
                            <button
                              className="primary"
                              onClick={() => download(selected.id, selected.current_version!)}
                            >
                              <ArrowDownToLine size={16} />
                              Download
                            </button>
                            <button
                              className="secondary"
                              onClick={() => {
                                setShareVersion(selected.current_version);
                                showModal('share');
                              }}
                            >
                              <Link2 size={16} />
                              Share
                            </button>
                          </>
                        )}
                        <button className="secondary" onClick={() => showModal('rename')}>
                          Rename
                        </button>
                        <button className="secondary" onClick={() => showModal('move')}>
                          Move
                        </button>
                        {selected.kind === 'FILE' && (
                          <button className="secondary full" onClick={() => chooseUpload(selected)}>
                            <CloudUpload size={16} />
                            Upload new version
                          </button>
                        )}
                        <button
                          className="text-button danger-text full"
                          onClick={() => {
                            setChecked([]);
                            showModal('trash');
                          }}
                        >
                          <Trash2 size={15} />
                          Move to trash
                        </button>
                      </>
                    )}
                  </div>
                  {selected.conflict_of && !selected.trashed_at && (
                    <div className="conflict-detail">
                      <TriangleAlert size={17} />
                      <p>This is a conflict copy. Your original file has not been overwritten.</p>
                      <button
                        className="text-button"
                        onClick={() =>
                          void api<Entry>('/files/' + selected.conflict_of)
                            .then(setSelected)
                            .catch((e) => setError(e.message))
                        }
                      >
                        View original file <ArrowUpRight size={14} />
                      </button>
                      <button
                        className="secondary full"
                        disabled={busy}
                        onClick={() =>
                          void action(
                            () => api('/files/' + selected.id + '/resolve', 'POST'),
                            'Both files kept. Conflict resolved.',
                          )
                        }
                      >
                        Keep both & resolve
                      </button>
                    </div>
                  )}
                  {selected.kind === 'FILE' && (
                    <>
                      <div className="section-caption">
                        <History size={16} />
                        Version history <span>{versions.length}</span>
                      </div>
                      <div className="versions">
                        {versions.map((v, i) => (
                          <article key={v.id} className="version">
                            <span className={'version-dot ' + (i === 0 ? 'current' : '')} />
                            <div className="version-title">
                              <strong>Version {v.version_no}</strong>
                              {v.id === selected.current_version && (
                                <span className="current-label">Current</span>
                              )}
                            </div>
                            <p>
                              {date(v.created_at)} · {size(v.size)}
                            </p>
                            <small>
                              {v.restored_from ? 'Web · Restore' : v.source}
                              {v.restored_from ? ' · Restored from history' : ''}
                            </small>
                            <details>
                              <summary>SHA-256 checksum</summary>
                              <code>{v.sha256}</code>
                            </details>
                            <div className="version-links">
                              <button onClick={() => download(selected.id, v.id)}>Download</button>
                              {!selected.trashed_at && v.id !== selected.current_version && (
                                <button
                                  onClick={() => {
                                    setRestoreVersion(v);
                                    showModal('restore');
                                  }}
                                >
                                  Restore this version
                                </button>
                              )}
                              {!selected.trashed_at && (
                                <button
                                  onClick={() => {
                                    setShareVersion(v.id);
                                    showModal('share');
                                  }}
                                >
                                  Share
                                </button>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="detail-footnote">
                    File ID<span>{selected.id}</span>
                  </div>
                </aside>
              )}
            </section>
          )}
          {view === 'shares' && (
            <section className="files-card standalone">
              <div className="card-title">
                <h3>
                  Your shared links <span>{shares.length}</span>
                </h3>
                <span>Read-only · Version-specific</span>
              </div>
              {shares.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">
                    <Link2 size={32} />
                  </span>
                  <h3>Share just what you mean to</h3>
                  <p>Open a file to create a read-only link to a specific version.</p>
                  <button className="secondary" onClick={() => navigate('files')}>
                    Go to My files
                    <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>File & version</th>
                        <th>Created</th>
                        <th>Expires</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {shares
                        .filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
                        .map((s) => (
                          <tr key={s.id}>
                            <td>
                              <div className="file-name">
                                <Glyph name={s.name} />
                                <span>
                                  <strong>{s.name}</strong>
                                  <small>Pinned version V{s.version_no}</small>
                                </span>
                              </div>
                            </td>
                            <td>{date(s.created_at)}</td>
                            <td>{date(s.expires_at)}</td>
                            <td>
                              <span
                                className={`status-badge ${s.revoked_at || s.expires_at < Date.now() ? 'neutral' : ''}`}
                              >
                                {s.revoked_at
                                  ? 'Revoked'
                                  : s.expires_at < Date.now()
                                    ? 'Expired'
                                    : 'Active'}
                              </span>
                            </td>
                            <td>
                              {!s.revoked_at && s.expires_at > Date.now() && (
                                <button
                                  className="text-button danger-text"
                                  disabled={busy}
                                  onClick={() =>
                                    void action(
                                      () => api('/shares/' + s.id, 'DELETE'),
                                      'Link revoked. New access is blocked.',
                                    )
                                  }
                                >
                                  Revoke link
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="files-footer">
                <span>
                  <ShieldCheck size={13} />
                  Every download checks link access. Downloads already in progress cannot be
                  recalled.
                </span>
              </div>
            </section>
          )}
          {view === 'activity' && (
            <section className="files-card standalone">
              <div className="card-title">
                <h3>Your file activity</h3>
                <span>Latest 200 events</span>
              </div>
              {activity.length === 0 ? (
                <div className="empty-state">
                  <ActivityIcon size={35} />
                  <h3>A fresh start</h3>
                  <p>Uploads, restores, and shares will appear here.</p>
                </div>
              ) : (
                <div className="activity-list">
                  {activity.map((a) => (
                    <div className="activity-row" key={a.id}>
                      <span className={`activity-icon ${a.action === 'CONFLICT' ? 'orange' : ''}`}>
                        {a.action.includes('SHARE') ? (
                          <Link2 size={18} />
                        ) : a.action.includes('TRASH') ? (
                          <Trash2 size={18} />
                        ) : a.action === 'CONFLICT' ? (
                          <TriangleAlert size={18} />
                        ) : (
                          <History size={18} />
                        )}
                      </span>
                      <div>
                        <strong>{a.name}</strong>
                        <p>{activityDescription(a)}</p>
                      </div>
                      <time>{date(a.created_at)}</time>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {view === 'transfers' && (
            <section className="files-card standalone">
              <div className="card-title">
                <h3>
                  Upload tasks <span>{transfer.jobs.length}</span>
                </h3>
                <span>This browser · Upload sessions last 7 days</span>
              </div>
              <div className="transfer-note">
                <ShieldCheck size={17} />
                <p>
                  After upload, your file is verified and published as a version. After a refresh,
                  select the original file to resume. Local folder sync is not available in this
                  edition.
                </p>
              </div>
              {transfer.jobs.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">
                    <CloudUpload size={34} />
                  </span>
                  <h3>Ready when you are</h3>
                  <p>Track uploads, resume paused transfers, and retry when needed.</p>
                  <button className="primary" onClick={() => chooseUpload()}>
                    <Plus size={17} />
                    Upload files
                  </button>
                </div>
              ) : (
                <div className="transfers-list">
                  {transfer.jobs.map((j) => (
                    <div className="transfer-row" key={j.key}>
                      <Glyph name={j.name} />
                      <div className="transfer-body">
                        <div className="transfer-heading">
                          <strong>{j.name}</strong>
                          <span className={j.status === 'failed' ? 'danger-text' : ''}>
                            {labels[j.status]}
                          </span>
                        </div>
                        <div
                          className={`progress-track ${j.status === 'conflict' ? 'warning' : ''}`}
                        >
                          <span style={{ width: j.progress + '%' }} />
                        </div>
                        <div className="transfer-meta">
                          <span>
                            {size(j.size)} · {j.progress}%{j.status === 'hashing' ? ' hashed' : ''}
                          </span>
                          {j.error && <p>{j.error}</p>}
                        </div>
                      </div>
                      <div className="transfer-actions">
                        {['hashing', 'uploading', 'queued'].includes(j.status) && (
                          <button
                            className="icon-button"
                            aria-label={'Pause ' + j.name}
                            onClick={() => transfer.pause(j.key)}
                          >
                            <Pause size={18} />
                          </button>
                        )}
                        {['paused', 'failed'].includes(j.status) && (
                          <button
                            className="secondary"
                            onClick={() => {
                              if (!transfer.resume(j.key)) {
                                resumeKey.current = j.key;
                                resumeInput.current?.click();
                              }
                            }}
                          >
                            <Play size={14} />
                            Resume
                          </button>
                        )}
                        {!['published', 'conflict', 'cancelled'].includes(j.status) && (
                          <button
                            className="icon-button"
                            aria-label={'Cancel ' + j.name}
                            onClick={() => void transfer.cancel(j)}
                          >
                            <X size={18} />
                          </button>
                        )}
                        {j.status === 'published' && (
                          <CheckCheck className="green-text" size={22} />
                        )}{' '}
                        {j.status === 'conflict' && (
                          <button className="text-button" onClick={() => navigate('conflicts')}>
                            Review conflicts
                            <ArrowRight size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          <footer className="page-footer">
            <span>A clear trail for every file.</span>
            <span>
              <span className="tiny-dot" /> FILETRAIL WORKSPACE
            </span>
          </footer>
          {drag && (
            <div className="drop-overlay">
              <CloudUpload size={48} />
              <h2>Drop files to upload</h2>
              <p>Your files will be added to this folder</p>
            </div>
          )}
        </main>
        {transfer.active > 0 && view !== 'transfers' && (
          <button className="transfer-float" onClick={() => navigate('transfers')}>
            <span className="transfer-float-icon">
              <CloudUpload size={21} />
            </span>
            <div>
              <strong>{transfer.active} active transfers</strong>
              <small>
                {
                  labels[
                    transfer.jobs.find(
                      (j) => !['published', 'conflict', 'cancelled'].includes(j.status),
                    )!.status
                  ]
                }
              </small>
            </div>
            <ChevronRight size={18} />
          </button>
        )}
      </div>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        multiple
        onChange={(e) => {
          if (e.target.files?.length) {
            transfer.add([...e.target.files], parent, uploadTarget.current);
            setToast('Added to the queue. Follow progress in Transfers.');
          }
          e.target.value = '';
        }}
        aria-label="Choose files to upload"
      />
      <input
        ref={resumeInput}
        className="visually-hidden"
        type="file"
        onChange={(e) => {
          if (e.target.files?.[0]) transfer.resume(resumeKey.current, e.target.files[0]);
          e.target.value = '';
        }}
        aria-label="Select the original file"
      />
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            className="icon-button"
            onClick={() => setToast('')}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {modal && (
        <Modal
          title={
            {
              folder: 'New folder',
              rename: 'Rename file',
              move: 'Move file',
              trash: 'Move to trash',
              share: 'Create a shared link',
              restore: 'Restore a version',
            }[modal]
          }
          close={() => {
            if (!busy) setModal(null);
          }}
        >
          {(modal === 'folder' || modal === 'rename') && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = new FormData(e.currentTarget).get('name');
                void action(
                  () =>
                    modal === 'folder'
                      ? api('/folders', 'POST', { name, parentId: parent })
                      : api('/files/' + selected!.id, 'PATCH', {
                          name,
                          parentId: selected!.parent_id,
                        }),
                  modal === 'folder'
                    ? 'Folder created.'
                    : 'Name updated. Version history is preserved.',
                );
              }}
            >
              <label>
                Name
                <input
                  name="name"
                  defaultValue={modal === 'rename' ? selected?.name : ''}
                  placeholder="e.g. Project documents"
                  required
                  maxLength={255}
                />
              </label>
              <p className="modal-description">Renaming changes the name, not the history.</p>
              <ModalError message={modalError} />
              <button className="primary full" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </form>
          )}
          {modal === 'move' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const value = new FormData(e.currentTarget).get('parent');
                void action(
                  () =>
                    api('/files/' + selected!.id, 'PATCH', {
                      name: selected!.name,
                      parentId: value || null,
                    }),
                  'File moved.',
                );
              }}
            >
              <label>
                Destination folder
                <select name="parent" defaultValue={selected?.parent_id ?? ''}>
                  <option value="">All files / Root</option>
                  {folders
                    .filter((f) => f.id !== selected?.id)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} · {f.id.slice(0, 6)}
                      </option>
                    ))}
                </select>
              </label>
              <ModalError message={modalError} />
              <button className="primary full" disabled={busy}>
                Move here
              </button>
            </form>
          )}
          {modal === 'trash' && (
            <>
              <p className="modal-description">
                Move{' '}
                {checked.length ? `the selected ${checked.length} items` : `“${selected?.name}”`} to
                trash? Files and version history are kept so you can restore them later. Existing
                shared links must be revoked separately.
              </p>
              <ModalError message={modalError} />
              <div className="modal-actions">
                <button className="secondary" onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      for (const id of checked.length ? checked : [selected!.id])
                        await api('/files/' + id, 'DELETE');
                    }, 'Moved to trash.')
                  }
                >
                  Move to trash
                </button>
              </div>
            </>
          )}
          {modal === 'restore' && (
            <>
              <p className="modal-description">
                Restore “{selected?.name}” to version {restoreVersion?.version_no}? This creates a
                new version and keeps your current content and all previous versions.
              </p>
              <ModalError message={modalError} />
              <button
                className="primary full"
                disabled={busy}
                onClick={() =>
                  void action(
                    () =>
                      api('/files/' + selected!.id + '/restore', 'POST', {
                        versionId: restoreVersion!.id,
                        baseVersion: selected!.current_version,
                        requestKey: restoreKey.current,
                      }),
                    'Restored as a new version.',
                  )
                }
              >
                Create restored version
              </button>
            </>
          )}
          {modal === 'share' &&
            (newLink ? (
              <>
                <div className="link-created">
                  <span>
                    <Check size={20} />
                  </span>
                  <h3>Your link is ready</h3>
                  <p>
                    This link stays pinned to the selected version, even after you make changes.
                  </p>
                </div>
                <label>
                  Save this link
                  <input readOnly value={newLink} onFocus={(e) => e.target.select()} />
                </label>
                <button
                  className="primary full"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(newLink)
                      .then(() => setToast('Link copied.'))
                      .catch(() => setToast('Select the link above and copy it manually.'))
                  }
                >
                  <Copy size={16} />
                  Copy link
                </button>
                <p className="modal-description">
                  This link is only shown once. Save a copy now. You can revoke access from Shared
                  links.
                </p>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const days = Number(new FormData(e.currentTarget).get('days'));
                  setBusy(true);
                  api<{ path: string }>(`/files/${selected!.id}/shares`, 'POST', {
                    versionId: shareVersion,
                    days,
                  })
                    .then((r) => {
                      setNewLink(location.origin + r.path);
                      void refresh();
                    })
                    .catch((e) => setModalError(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                <p className="modal-description">
                  Share a specific version of “{selected?.name}”. Anyone with the link can download
                  this version.
                </p>
                <label>
                  Link expires in
                  <select name="days" defaultValue="7">
                    <option value="1">1 day</option>
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                  </select>
                </label>
                <div className="info-banner">
                  <ShieldCheck size={16} />
                  <p>
                    Revoke new access at any time. Downloads already in progress cannot be recalled.
                  </p>
                </div>
                <ModalError message={modalError} />
                <button className="primary full" disabled={busy}>
                  <Link2 size={16} />
                  Create read-only link
                </button>
              </form>
            ))}
        </Modal>
      )}
    </div>
  );
}
function ModalError({ message }: { message: string }) {
  return message ? (
    <p className="form-error" role="alert">
      {message}
    </p>
  ) : null;
}
function Shared({ token }: { token: string }) {
  const [file, setFile] = useState<{
      name: string;
      size: number;
      version_no: number;
      sha256: string;
      expires_at: number;
    } | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    api<typeof file>('/public/shares/' + encodeURIComponent(token))
      .then(setFile)
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <div className="share-page">
      <a href="/" className="logo-link">
        <Logo />
      </a>
      <section className="share-card">
        {error ? (
          <>
            <span className="empty-icon">
              <Link2 size={30} />
            </span>
            <h1>This link is unavailable</h1>
            <p>{error}</p>
            <a className="secondary" href="/">
              Back to workspace
              <ArrowRight size={16} />
            </a>
          </>
        ) : file ? (
          <>
            <span className="eyebrow muted">SHARED WITH YOU</span>
            <Glyph name={file.name} large />
            <h1>{file.name}</h1>
            <p>
              {size(file.size)} · Pinned version V{file.version_no}
            </p>
            <a
              className="primary full"
              href={'/api/public/shares/' + encodeURIComponent(token) + '/download'}
            >
              <ArrowDownToLine size={17} />
              Download file
            </a>
            <div className="share-info">
              <span>Expires</span>
              <strong>{date(file.expires_at)}</strong>
            </div>
            <details>
              <summary>View SHA-256 checksum</summary>
              <code>{file.sha256}</code>
            </details>
            <p className="modal-description">
              <ShieldCheck size={15} />
              Read-only access. Link permissions are checked on every download.
            </p>
          </>
        ) : (
          <LoaderCircle className="spin" />
        )}
      </section>
      <p className="share-footer">Shared with FileTrail · Every file. Every version.</p>
    </div>
  );
}
