// Pure helpers for the Grocery List plugin.

export interface Task { id: string; content: string; order?: number; child_order?: number; added_at?: string; labels?: string[] }

/** Todoist content can carry Markdown/links; the wall shows plain text. */
export function plain(content: string): string {
  return content
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim();
}

export function normalize(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Capitalise the first letter the way people type grocery items. */
export function tidy(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

export function isOnList(list: Task[], name: string): boolean {
  const n = normalize(name);
  return list.some((t) => normalize(plain(t.content)) === n);
}

/** Recently used items, most recent first, without duplicates, capped. */
export function pushRecent(recent: string[], name: string, cap = 24): string[] {
  const n = normalize(name);
  return [tidy(name), ...recent.filter((r) => normalize(r) !== n)].slice(0, cap);
}

/** Chips offered for one-tap re-adding: recents first, then staples, minus what's already on the list. */
export function quickPicks(recent: string[], staples: string[], list: Task[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...recent, ...staples]) {
    const n = normalize(s);
    if (!n || seen.has(n) || isOnList(list, s)) continue;
    seen.add(n);
    out.push(tidy(s));
    if (out.length >= max) break;
  }
  return out;
}

/** Suggestions while typing: prefix matches first, then substring matches. */
export function suggest(query: string, pool: string[], list: Task[], max = 4): string[] {
  const q = normalize(query);
  if (!q) return [];
  const uniq = Array.from(new Map(pool.map((p) => [normalize(p), tidy(p)])).values()).filter((p) => !isOnList(list, p));
  const pre = uniq.filter((p) => normalize(p).startsWith(q) && normalize(p) !== q);
  const mid = uniq.filter((p) => !normalize(p).startsWith(q) && normalize(p).includes(q));
  return [...pre, ...mid].slice(0, max);
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => (a.child_order ?? a.order ?? 0) - (b.child_order ?? b.order ?? 0));
}

export function parseLabels(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

/** Tasks for this block: any of the given labels; optionally also tasks with none of the known store labels. */
export function filterByLabels(tasks: Task[], labels: string[], includeUnlabelled: boolean): Task[] {
  if (!labels.length) return tasks;
  const want = new Set(labels.map(normalize));
  return tasks.filter((t) => {
    const ls = (t.labels ?? []).map(normalize);
    if (ls.some((l) => want.has(l))) return true;
    return includeUnlabelled && ls.length === 0;
  });
}
