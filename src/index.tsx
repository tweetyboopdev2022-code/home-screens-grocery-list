import React from 'react';
import type { PluginComponentProps } from './hs-plugin';
import { hostFrameStyle } from './host-style';
import { Icon, I } from './icons';
import { Task, plain, tidy, isOnList, pushRecent, quickPicks, suggest, sortTasks, parseLabels, filterByLabels } from './logic';

const PLUGIN_ID = 'grocery-list';
const API = 'https://api.todoist.com/api/v1';
const AUTH = { header: { Authorization: 'Bearer {{todoist_token}}' } };
const RECENT_KEY = 'grocery-list:recent';

function sdk() { return (window as any).__HS_SDK__; }

async function call(url: string, method = 'GET', body?: unknown) {
  const res: Response = await sdk().pluginFetch(PLUGIN_ID, {
    url, method, cacheTtlMs: 0, secretInjections: AUTH,
    ...(body ? { payload: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

function readRecent(key: string): string[] { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
function writeRecent(key: string, r: string[]) { try { localStorage.setItem(key, JSON.stringify(r)); } catch { /* ignore */ } }

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
  ['1', '2', '3', '4', '5', 'é', 'è', 'à', 'ç', "'"],
];

export default function GroceryList({ config, style }: PluginComponentProps) {
  const projectName = String(config.projectName ?? 'Groceries');
  const labels = parseLabels(String(config.labelFilter ?? ''));
  const includeUnlabelled = config.includeUnlabelled === true;
  const title = String(config.title || (labels.length ? labels.join(' · ') : projectName));
  const recentKey = RECENT_KEY + (labels.length ? ':' + labels.join(',').toLowerCase() : '');
  const accent = String(config.accentColor || '#16a34a');
  const staples = String(config.staples ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const maxPicks = Number(config.quickPicks ?? 8);
  const refreshMs = Math.max(30000, Number(config.refreshIntervalMs ?? 60000));
  const ink = (a: number) => `color-mix(in srgb, ${style.textColor || 'currentColor'} ${Math.round(a * 100)}%, transparent)`;

  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [tasks, setTasks] = React.useState<Task[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [recent, setRecent] = React.useState<string[]>(() => readRecent(recentKey));
  const [busy, setBusy] = React.useState<Set<string>>(new Set());
  const [typing, setTyping] = React.useState(false);
  const [text, setText] = React.useState('');
  const [shift, setShift] = React.useState(true);

  const remember = (name: string) => setRecent((r) => { const n = pushRecent(r, name); writeRecent(recentKey, n); return n; });

  const load = React.useCallback(async () => {
    try {
      let pid = projectId;
      if (!pid) {
        const pj = await call(`${API}/projects?limit=200`);
        const p = (pj?.results ?? pj ?? []).find((x: any) => String(x.name).trim().toLowerCase() === projectName.trim().toLowerCase());
        if (!p) { setError(`No Todoist project called “${projectName}”.`); return; }
        pid = String(p.id); setProjectId(pid);
      }
      const tj = await call(`${API}/tasks?project_id=${pid}&limit=200`);
      setTasks(sortTasks(filterByLabels(tj?.results ?? tj ?? [], labels, includeUnlabelled)));
      setError(null);
    } catch (e) {
      const m = String((e as Error).message);
      setError(/HTTP (401|403|500)/.test(m) ? 'Add your Todoist API token in Plugins → grocery-list.' : 'Can’t reach Todoist right now.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projectName, labels.join(','), includeUnlabelled]);

  React.useEffect(() => { load(); const id = setInterval(load, refreshMs); return () => clearInterval(id); }, [load, refreshMs]);

  const mark = (id: string, on: boolean) => setBusy((b) => { const n = new Set(b); on ? n.add(id) : n.delete(id); return n; });

  const complete = async (t: Task) => {
    mark(t.id, true); remember(plain(t.content));
    try { await call(`${API}/tasks/${t.id}/close`, 'POST'); setTasks((l) => (l ?? []).filter((x) => x.id !== t.id)); }
    catch { /* keep it on the list */ } finally { mark(t.id, false); }
  };
  const remove = async (t: Task) => {
    mark(t.id, true);
    try { await call(`${API}/tasks/${t.id}`, 'DELETE'); setTasks((l) => (l ?? []).filter((x) => x.id !== t.id)); }
    catch { /* ignore */ } finally { mark(t.id, false); }
  };
  const add = async (raw: string) => {
    const name = tidy(raw);
    if (!name || !projectId || isOnList(tasks ?? [], name)) return;
    const tmp: Task = { id: `tmp-${Date.now()}`, content: name, child_order: 1e9, labels: labels.slice(0, 1) };
    setTasks((l) => [...(l ?? []), tmp]); remember(name);
    try {
      const created = await call(`${API}/tasks`, 'POST', { content: name, project_id: projectId, ...(labels.length ? { labels: [labels[0]] } : {}) });
      setTasks((l) => (l ?? []).map((x) => (x.id === tmp.id ? { ...created, child_order: created.child_order ?? 1e9 } : x)));
    } catch { setTasks((l) => (l ?? []).filter((x) => x.id !== tmp.id)); }
  };

  const list = tasks ?? [];
  const picks = quickPicks(recent, staples, list, maxPicks);
  const sugg = suggest(text, [...recent, ...staples], list, 3);

  const root: React.CSSProperties = {
    ...hostFrameStyle(style as any),
    width: '100%', height: '100%', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
  };
  const btn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    appearance: 'none', border: 'none', font: 'inherit', color: 'inherit', cursor: 'pointer',
    background: ink(0.06), borderRadius: '0.5em', ...extra,
  });

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', marginBottom: '0.25em' }}>
      <h2 style={{ margin: 0, fontSize: '1.1em', fontWeight: 600 }}>{title}</h2>
      <span style={{ fontSize: '0.65em', opacity: 0.35 }}>{tasks ? `${list.length} item${list.length === 1 ? '' : 's'}` : ''}</span>
      <button onClick={() => { setText(''); setShift(true); setTyping(true); }} style={btn({ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.3em', padding: '0.35em 0.75em', background: accent, color: '#fff', fontSize: '0.75em', fontWeight: 600, borderRadius: '999px' })}>
        <Icon d={I.plus} size="1.1em" stroke={2.5} /> Add
      </button>
    </div>
  );

  return (
    <div style={root}>
      {header}
      <div style={{ height: 1, background: ink(0.08), margin: '0.35em 0 0.6em' }} />

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '0.25em' }}>
        {error && <div style={{ margin: 'auto', textAlign: 'center', fontSize: '0.8em', opacity: 0.6, maxWidth: '18em' }}>{error}</div>}
        {!error && tasks && list.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', opacity: 0.35 }}>
            <Icon d={I.cart} size="2em" stroke={1.5} style={{ margin: '0 auto 0.3em' }} />
            <div style={{ fontSize: '0.8em' }}>List is empty</div>
          </div>
        )}
        {list.map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.55em', padding: '0.4em 0.4em 0.4em 0.6em', borderRadius: '0.5em', background: ink(0.06), opacity: busy.has(t.id) || t.id.startsWith('tmp-') ? 0.45 : 1, transition: 'opacity .2s' }}>
            <button aria-label={`Got ${plain(t.content)}`} onClick={() => complete(t)} style={btn({ width: '1.1em', height: '1.1em', flex: '0 0 1.1em', borderRadius: '50%', background: 'transparent', border: `0.12em solid ${ink(0.4)}`, padding: 0 })} />
            <span style={{ flex: 1, minWidth: 0, fontSize: '0.85em', fontWeight: 500, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{plain(t.content)}</span>
            <button aria-label={`Remove ${plain(t.content)}`} onClick={() => remove(t)} style={btn({ background: 'transparent', padding: '0.25em', opacity: 0.35, display: 'flex' })}>
              <Icon d={I.x} size="0.9em" />
            </button>
          </div>
        ))}
      </div>

      {picks.length > 0 && !error && (
        <div style={{ marginTop: '0.6em' }}>
          <div style={{ fontSize: '0.6em', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.6, marginBottom: '0.4em' }}>Add again</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em' }}>
            {picks.map((p) => (
              <button key={p} onClick={() => add(p)} style={btn({ display: 'flex', alignItems: 'center', gap: '0.25em', padding: '0.3em 0.6em', fontSize: '0.7em', fontWeight: 500, borderRadius: '999px' })}>
                <Icon d={I.plus} size="0.9em" style={{ opacity: 0.5 }} />{p}
              </button>
            ))}
          </div>
        </div>
      )}

      {typing && (
        <div style={{ position: 'absolute', inset: 0, background: style.backgroundColor && style.backgroundColor !== 'transparent' ? style.backgroundColor : '#fdfcf9', borderRadius: 'inherit', padding: 'inherit', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '0.5em', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
            <h2 style={{ margin: 0, fontSize: '1.1em', fontWeight: 600 }}>Add to {title}</h2>
            <button onClick={() => setTyping(false)} style={btn({ marginLeft: 'auto', padding: '0.3em', display: 'flex' })} aria-label="Close"><Icon d={I.x} size="1em" /></button>
          </div>
          <div style={{ minHeight: '2.2em', display: 'flex', alignItems: 'center', padding: '0 0.7em', borderRadius: '0.5em', border: `0.08em solid ${ink(0.2)}`, fontSize: '1em', fontWeight: 500 }}>
            {text || <span style={{ opacity: 0.35 }}>Type an item…</span>}<span style={{ width: 2, height: '1.1em', background: accent, marginLeft: 2, animation: 'none' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.35em', minHeight: '1.9em', flexWrap: 'wrap' }}>
            {sugg.map((s) => (
              <button key={s} onClick={() => { add(s); setText(''); setShift(true); }} style={btn({ padding: '0.3em 0.7em', fontSize: '0.75em', fontWeight: 500, borderRadius: '999px' })}>{s}</button>
            ))}
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.3em' }}>
            {ROWS.map((row, ri) => (
              <div key={ri} style={{ flex: 1, maxHeight: '3.4em', display: 'flex', gap: '0.3em', justifyContent: 'center' }}>
                {ri === 2 && (
                  <button onClick={() => setShift((s) => !s)} style={btn({ flex: 1.5, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: shift ? ink(0.18) : ink(0.06) })} aria-label="Shift"><Icon d={I.shift} size="0.9em" /></button>
                )}
                {row.map((k) => (
                  <button key={k} onClick={() => { setText((t) => t + (shift ? k.toUpperCase() : k)); setShift(false); }} style={btn({ flex: 1, height: '100%', fontSize: '0.85em', fontWeight: 500, maxWidth: '3em' })}>{shift ? k.toUpperCase() : k}</button>
                ))}
                {ri === 2 && (
                  <button onClick={() => setText((t) => t.slice(0, -1))} style={btn({ flex: 1.5, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' })} aria-label="Delete"><Icon d={I.back} size="0.9em" /></button>
                )}
              </div>
            ))}
            <div style={{ flex: 1, maxHeight: '3.4em', display: 'flex', gap: '0.3em' }}>
              <button onClick={() => setText((t) => (t && !t.endsWith(' ') ? t + ' ' : t))} style={btn({ flex: 3, height: '100%', fontSize: '0.75em', opacity: 0.8 })}>space</button>
              <button disabled={!text.trim()} onClick={() => { add(text); setText(''); setShift(true); }} style={btn({ flex: 2, height: '100%', fontSize: '0.8em', fontWeight: 600, background: text.trim() ? accent : ink(0.1), color: text.trim() ? '#fff' : 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3em' })}>
                <Icon d={I.plus} size="1em" stroke={2.5} /> Add
              </button>
              <button onClick={() => setTyping(false)} style={btn({ flex: 1.5, height: '100%', fontSize: '0.8em', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3em' })}>
                <Icon d={I.check} size="1em" /> Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
