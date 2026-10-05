import React from 'react';
import type { PluginComponentProps } from './hs-plugin';
import { hostFrameStyle } from './host-style';
import { Icon, I } from './icons';
import { Task, plain, tidy, isOnList, pushRecent, quickPicks, suggest, sortTasks, parseLabels, filterByLabels, normalize } from './logic';

const PLUGIN_ID = 'grocery-list';
const API = 'https://api.todoist.com/api/v1';
const AUTH = { header: { Authorization: 'Bearer {{todoist_token}}' } };
const RECENT_KEY = 'grocery-list:recent';
const STORE_KEY = 'grocery-list:stores';

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
  // Staples: "Milk@IGA, Paper towels@Costco" (store optional)
  const stapleDefs = String(config.staples ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [n, st] = s.split('@').map((x) => x.trim()); return { name: n, store: st ?? '' }; });
  const staples = stapleDefs.map((d) => d.name);
  const maxPicks = Number(config.quickPicks ?? 8);
  const refreshMs = Math.max(10000, Math.min(Number(config.refreshIntervalMs ?? 15000), 15000));
  const ink = (a: number) => `color-mix(in srgb, ${style.textColor || 'currentColor'} ${Math.round(a * 100)}%, transparent)`;

  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [tasks, setTasks] = React.useState<Task[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [recent, setRecent] = React.useState<string[]>(() => readRecent(recentKey));
  const [busy, setBusy] = React.useState<Set<string>>(new Set());
  const [typing, setTyping] = React.useState(false);
  const [text, setText] = React.useState('');
  const [shift, setShift] = React.useState(true);

  // Items ticked/removed here stay hidden even if a refresh that started earlier still lists them.
  const gone = React.useRef<Map<string, number>>(new Map());
  const notGone = (l: Task[]) => { const now = Date.now(); for (const [id, t] of gone.current) if (now - t > 120000) gone.current.delete(id); return l.filter((x) => !gone.current.has(x.id)); };
  const remember = (name: string, lbl?: string) => {
    setRecent((r) => { const n = pushRecent(r, name); writeRecent(recentKey, n); return n; });
    if (lbl) { try { const m = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); m[normalize(name)] = lbl; localStorage.setItem(STORE_KEY, JSON.stringify(m)); } catch { /* ignore */ } }
  };
  const storeFor = (name: string): string => {
    try { const m = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); if (m[normalize(name)]) return m[normalize(name)]; } catch { /* ignore */ }
    return stapleDefs.find((d) => normalize(d.name) === normalize(name))?.store ?? '';
  };

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
      setTasks(notGone(sortTasks(filterByLabels(tj?.results ?? tj ?? [], labels, includeUnlabelled))));
      setError(null);
    } catch (e) {
      const m = String((e as Error).message);
      setError(/HTTP (401|403|500)/.test(m) ? 'Add your Todoist API token in Plugins → grocery-list.' : 'Can’t reach Todoist right now.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projectName, labels.join(','), includeUnlabelled]);

  React.useEffect(() => {
    load(); const id = setInterval(load, refreshMs);
    const onVis = () => { if (!document.hidden) load(); }; document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [load, refreshMs]);

  const mark = (id: string, on: boolean) => setBusy((b) => { const n = new Set(b); on ? n.add(id) : n.delete(id); return n; });

  // Optimistic: the item leaves the list right away; it comes back only if Todoist refuses.
  const complete = async (t: Task) => {
    mark(t.id, true); remember(plain(t.content), (t.labels ?? [])[0]);
    gone.current.set(t.id, Date.now()); setTasks((l) => (l ?? []).filter((x) => x.id !== t.id));
    try { await call(`${API}/tasks/${t.id}/close`, 'POST'); }
    catch { gone.current.delete(t.id); setTasks((l) => sortTasks([...(l ?? []), t])); setToast(`Couldn’t tick off ${plain(t.content)}`); }
    finally { mark(t.id, false); }
  };
  const remove = async (t: Task) => {
    mark(t.id, true);
    gone.current.set(t.id, Date.now()); setTasks((l) => (l ?? []).filter((x) => x.id !== t.id));
    try { await call(`${API}/tasks/${t.id}`, 'DELETE'); }
    catch { gone.current.delete(t.id); setTasks((l) => sortTasks([...(l ?? []), t])); setToast(`Couldn’t remove ${plain(t.content)}`); }
    finally { mark(t.id, false); }
  };
  const stores = parseLabels(String(config.storeLabels ?? 'IGA, Costco, Walmart, Amazon, Other'));
  const defaultStore = labels.find((l) => stores.some((s) => normalize(s) === normalize(l))) ?? labels[0] ?? '';
  const [store, setStore] = React.useState<string>(defaultStore);
  const [toast, setToast] = React.useState<string | null>(null);
  React.useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2500); return () => clearTimeout(id); }, [toast]);
  const shows = (lbl: string) => !labels.length || labels.some((l) => normalize(l) === normalize(lbl)) || (!lbl && includeUnlabelled);

  const add = async (raw: string, lbl: string = defaultStore) => {
    const name = tidy(raw);
    if (!name || !projectId) return;
    if (shows(lbl) && isOnList(tasks ?? [], name)) return;
    const itemLabels = lbl ? [lbl] : [];
    remember(name, lbl);
    const visible = shows(lbl);
    const tmp: Task = { id: `tmp-${Date.now()}`, content: name, child_order: 1e9, labels: itemLabels };
    if (visible) setTasks((l) => [...(l ?? []), tmp]);
    try {
      const created = await call(`${API}/tasks`, 'POST', { content: name, project_id: projectId, ...(itemLabels.length ? { labels: itemLabels } : {}) });
      if (visible) setTasks((l) => (l ?? []).map((x) => (x.id === tmp.id ? { ...created, child_order: created.child_order ?? 1e9 } : x)));
      else setToast(`${name} added to ${lbl || 'the list'}`);
    } catch { if (visible) setTasks((l) => (l ?? []).filter((x) => x.id !== tmp.id)); setToast(`Couldn’t add ${name}`); }
  };

  const list = tasks ?? [];
  const picks = quickPicks(recent, staples, list, maxPicks);
  const sugg = suggest(text, [...recent, ...staples], list, 3);

  const grouped = config.groupByStore === true;
  const hideEmpty = config.hideEmptyStores === true;
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const tick = (t: Task) => {
    if (checked.has(t.id)) return;
    setChecked((c) => new Set(c).add(t.id));
    setTimeout(() => { complete(t).finally(() => setChecked((c) => { const n = new Set(c); n.delete(t.id); return n; })); }, 450);
  };
  const openAdd = (st: string) => { setText(''); setShift(true); setStore(st); setTyping(true); };
  const storeColors: Record<string, string> = {};
  String(config.storeColors ?? 'IGA:#16a34a, Costco:#e31837, Walmart:#0071ce, Amazon:#e47911, Other:#78716c')
    .split(',').forEach((pair) => { const [k, v] = pair.split(':').map((x) => x.trim()); if (k && v) storeColors[normalize(k)] = v; });
  const groups = (() => {
    const out: { name: string; color: string; items: Task[] }[] = [];
    const used = new Set<string>();
    const known = (t: Task) => (t.labels ?? []).some((l) => stores.some((st) => normalize(st) === normalize(l)));
    const catchAll = stores.find((st) => normalize(st) === 'other');
    for (const st of stores) {
      const items = list.filter((t) => !used.has(t.id) && ((t.labels ?? []).some((l) => normalize(l) === normalize(st)) || (st === catchAll && !known(t))));
      items.forEach((t) => used.add(t.id));
      if (items.length || !hideEmpty) out.push({ name: st, color: storeColors[normalize(st)] ?? accent, items });
    }
    const rest = list.filter((t) => !used.has(t.id));
    if (rest.length) out.push({ name: 'Any store', color: ink(0.5), items: rest });
    return out;
  })();
  const renderRow = (t: Task, color: string = accent) => {
    const on = checked.has(t.id);
    return (
      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.55em', padding: '0.4em 0.4em 0.4em 0.55em', borderRadius: '0.5em', background: ink(0.06), opacity: on ? 0.55 : busy.has(t.id) || t.id.startsWith('tmp-') ? 0.45 : 1, transition: 'opacity .3s' }}>
        <button aria-label={`Got ${plain(t.content)}`} onClick={() => tick(t)} style={btn({ width: '1.15em', height: '1.15em', flex: '0 0 1.15em', borderRadius: '0.3em', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', background: on ? color : 'transparent', border: `0.12em solid ${on ? color : ink(0.4)}`, transition: 'background .2s' })}>
          {on && <Icon d={I.check} size="0.8em" stroke={3} />}
        </button>
        <span style={{ flex: 1, minWidth: 0, fontSize: '0.85em', fontWeight: 500, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: on ? 'line-through' : 'none' }}>{plain(t.content)}</span>
        {!grouped && labels.length !== 1 && (t.labels ?? []).filter((l) => stores.some((s) => normalize(s) === normalize(l))).slice(0, 1).map((l) => (
          <span key={l} style={{ fontSize: '0.55em', fontWeight: 500, padding: '0.2em 0.55em', borderRadius: '0.4em', background: ink(0.08), opacity: 0.75, whiteSpace: 'nowrap' }}>{l}</span>
        ))}
        <button aria-label={`Remove ${plain(t.content)}`} onClick={() => remove(t)} style={btn({ background: 'transparent', padding: '0.25em', opacity: 0.35, display: 'flex' })}>
          <Icon d={I.x} size="0.9em" />
        </button>
      </div>
    );
  };

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
      {!grouped && <button onClick={() => openAdd(defaultStore)} style={btn({ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.3em', padding: '0.35em 0.75em', background: accent, color: '#fff', fontSize: '0.75em', fontWeight: 600, borderRadius: '999px' })}>
        <Icon d={I.plus} size="1.1em" stroke={2.5} /> Add
      </button>}
    </div>
  );

  return (
    <div style={root}>
      {header}
      <div style={{ height: 1, background: ink(0.08), margin: '0.35em 0 0.6em' }} />

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '0.25em' }}>
        {error && <div style={{ margin: 'auto', textAlign: 'center', fontSize: '0.8em', opacity: 0.6, maxWidth: '18em' }}>{error}</div>}
        {!grouped && !error && tasks && list.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', opacity: 0.35 }}>
            <Icon d={I.cart} size="2em" stroke={1.5} style={{ margin: '0 auto 0.3em' }} />
            <div style={{ fontSize: '0.8em' }}>List is empty</div>
          </div>
        )}
        {!grouped && list.map((t) => renderRow(t))}
        {grouped && !error && tasks && list.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center' }}>
            <div style={{ fontSize: '3em', lineHeight: 1 }}>✅</div>
            <div style={{ fontSize: '1.4em', fontWeight: 700, marginTop: '0.3em' }}>All stocked up</div>
            <div style={{ fontSize: '0.8em', opacity: 0.55, marginTop: '0.2em' }}>Nothing on the list. Tap a store or a quick-add item below.</div>
          </div>
        )}
        {grouped && !error && list.length > 0 && (() => {
          const section = (g: typeof groups[number], grow: number) => (
            <div key={g.name} style={{ display: 'flex', flexDirection: 'column', gap: '0.3em', minHeight: '5.5em', flex: `${grow} 1 0`, overflow: 'hidden', padding: '0.6em 0.6em 0.5em', borderRadius: '0.8em', background: ink(0.03), borderTop: `0.22em solid ${g.color}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45em', marginBottom: '0.15em', flexShrink: 0 }}>
                <span style={{ fontSize: '0.8em', fontWeight: 600, color: g.color }}>{g.name}</span>
                <span style={{ fontSize: '0.6em', opacity: 0.35 }}>{g.items.length || ''}</span>
                {g.name !== 'Any store' && (
                  <button aria-label={`Add to ${g.name}`} onClick={() => openAdd(g.name)} style={btn({ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.25em', padding: '0.25em 0.6em', background: g.color, color: '#fff', fontSize: '0.62em', fontWeight: 600, borderRadius: '999px' })}>
                    <Icon d={I.plus} size="1.1em" stroke={2.5} /> Add
                  </button>
                )}
              </div>
              {g.items.length === 0 ? <div style={{ margin: 'auto', fontSize: '0.7em', opacity: 0.35 }}>Nothing needed</div> : (
                <div className="gl-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25em', scrollbarWidth: 'none', overscrollBehavior: 'contain' } as React.CSSProperties}>
                  {g.items.map((t) => renderRow(t, g.color))}
                </div>
              )}
            </div>
          );
          const featured = groups.find((g) => normalize(g.name) === normalize(String(config.featuredStore ?? 'IGA')));
          const rest = groups.filter((g) => g !== featured);
          const weight = (g: typeof groups[number]) => Math.max(1, g.items.length) + 1.5;
          if (!featured || !rest.length) {
            return <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.7em' }}>{groups.map((g) => section(g, weight(g)))}</div>;
          }
          // featured store spans two rows in the left column; the rest fill the grid around it
          const rows = Math.ceil((rest.length + 2) / 2);
          return (
            <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, gap: '0.7em' }}>
              <div style={{ gridColumn: 1, gridRow: 'span 2', display: 'flex', flexDirection: 'column', minHeight: 0 }}>{section(featured, 1)}</div>
              {rest.map((g) => <div key={g.name} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>{section(g, 1)}</div>)}
            </div>
          );
        })()}
      </div>

      {grouped && hideEmpty && !error && (() => {
        // Stores hidden because they're empty still need a way to add to them.
        const hidden = stores.filter((st) => !groups.some((g) => normalize(g.name) === normalize(st)));
        if (!hidden.length) return null;
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4em', marginTop: '0.6em', flexShrink: 0, fontSize: list.length ? '1em' : '1.35em' }}>
            <span style={{ fontSize: '0.6em', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.55, marginRight: '0.2em' }}>Add to</span>
            {hidden.map((st) => {
              const col = storeColors[normalize(st)] ?? accent;
              return (
                <button key={st} aria-label={`Add to ${st}`} onClick={() => openAdd(st)} style={btn({ display: 'flex', alignItems: 'center', gap: '0.3em', padding: '0.35em 0.8em', fontSize: '0.72em', fontWeight: 600, borderRadius: '999px', color: col, border: `0.1em solid ${col}`, background: 'transparent' })}>
                  <Icon d={I.plus} size="1em" stroke={2.5} />{st}
                </button>
              );
            })}
          </div>
        );
      })()}

      {grouped && !error && tasks && (() => {
        const featuredName = String(config.featuredStore ?? 'IGA');
        const qp = quickPicks(recent, staples, list, maxPicks);
        if (!qp.length) return null;
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4em', marginTop: '0.55em', flexShrink: 0, fontSize: list.length ? '1em' : '1.35em' }}>
            <span style={{ fontSize: '0.6em', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.55, marginRight: '0.2em' }}>Quick add</span>
            {qp.map((p) => {
              const st = storeFor(p) || featuredName;
              const col = storeColors[normalize(st)] ?? accent;
              return (
                <button key={p} aria-label={`Add ${p} to ${st}`} onClick={() => add(p, st)} style={btn({ display: 'flex', alignItems: 'center', gap: '0.35em', padding: '0.35em 0.8em', fontSize: '0.72em', fontWeight: 500, borderRadius: '999px' })}>
                  <span style={{ width: '0.5em', height: '0.5em', borderRadius: '50%', background: col, flexShrink: 0 }} />{p}
                </button>
              );
            })}
          </div>
        );
      })()}

      {!grouped && picks.length > 0 && !error && (
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

      {toast && !typing && (
        <div style={{ position: 'absolute', left: '50%', bottom: '1em', transform: 'translateX(-50%)', padding: '0.45em 0.9em', borderRadius: '999px', background: style.textColor || '#1c1917', color: style.backgroundColor && style.backgroundColor !== 'transparent' ? style.backgroundColor : '#fff', fontSize: '0.65em', fontWeight: 500, whiteSpace: 'nowrap', zIndex: 3 }}>{toast}</div>
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
          {stores.length > 0 && (
            <div style={{ display: 'flex', gap: '0.3em', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.6em', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.6, marginRight: '0.2em' }}>Store</span>
              {stores.map((st) => {
                const on = normalize(st) === normalize(store);
                return (
                  <button key={st} onClick={() => setStore(on ? '' : st)} style={btn({ padding: '0.3em 0.7em', fontSize: '0.7em', fontWeight: on ? 600 : 500, borderRadius: '999px', background: on ? accent : ink(0.06), color: on ? '#fff' : 'inherit' })}>{st}</button>
                );
              })}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.35em', minHeight: '1.9em', flexWrap: 'wrap' }}>
            {sugg.map((s) => (
              <button key={s} onClick={() => { add(s, store); setText(''); setShift(true); }} style={btn({ padding: '0.3em 0.7em', fontSize: '0.75em', fontWeight: 500, borderRadius: '999px' })}>{s}</button>
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
              <button disabled={!text.trim()} onClick={() => { add(text, store); setText(''); setShift(true); }} style={btn({ flex: 2, height: '100%', fontSize: '0.8em', fontWeight: 600, background: text.trim() ? accent : ink(0.1), color: text.trim() ? '#fff' : 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3em' })}>
                <Icon d={I.plus} size="1em" stroke={2.5} /> {store ? `Add · ${store}` : 'Add'}
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
