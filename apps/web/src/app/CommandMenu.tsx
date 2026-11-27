import { useMemo, useState } from 'preact/hooks';
import { ListPopup, filterEntries, type CommandCatalog, type MenuEntry } from '@taskite/ui';
import { dynamicEntries } from './commands.ts';
import type { AppController } from './controller.ts';

interface Entry extends MenuEntry {
  readonly keys: string;
  readonly enabled: boolean;
  /** Why it can't run, shown while `enabled` is false. */
  readonly unavailable: string;
  readonly run: () => void;
}

/** ⌘K: every command, project and label, recent ones first (PRD §8). */
export function CommandMenu({
  app,
  catalog,
  initial,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
  readonly initial: string;
}) {
  const [query, setQuery] = useState(initial);
  const [index, setIndex] = useState(0);
  const entries = useMemo<Entry[]>(() => {
    const commands = catalog.all
      .filter((c) => !c.hidden)
      .map((c) => ({
        id: c.id,
        title: c.title,
        group: c.group,
        keywords: `${c.keywords ?? ''} ${c.description}`,
        keys: catalog.keys(c).join(' '),
        enabled: catalog.isEnabled(c),
        unavailable: c.unavailable ?? 'Not available here.',
        run: () => catalog.run(c.id),
      }));
    const extra = dynamicEntries(app).map((e) => ({ ...e, keys: '', enabled: true, unavailable: '' }));
    return [...commands, ...extra];
  }, [app, catalog]);
  const results = filterEntries(entries, query, catalog.recentIds).slice(0, 80);
  const pick = (i: number) => {
    const entry = results[i];
    if (!entry || !entry.enabled) return;
    app.close();
    catalog.remember(entry.id);
    // Let the menu close (and focus go back) before the command runs.
    queueMicrotask(entry.run);
  };
  return (
    <ListPopup
      label="Command menu"
      placeholder="Type a command, project or label…"
      query={query}
      onQuery={(q) => {
        setQuery(q);
        setIndex(0);
      }}
      index={index}
      onIndex={setIndex}
      count={results.length}
      onPick={pick}
      onClose={() => app.close()}
    >
      {results.map((e, i) => (
        <li
          key={e.id}
          id={`tk-palette-${i}`}
          role="option"
          aria-selected={i === index}
          aria-disabled={!e.enabled}
          class={e.enabled ? undefined : 'tk-disabled'}
          onPointerMove={() => setIndex(i)}
          onClick={() => pick(i)}
        >
          <span class="tk-palette-title">{e.title}</span>
          {/* A command that can't run says why, where its group would be. */}
          <span class="tk-palette-group">{e.enabled ? e.group : e.unavailable}</span>
          {e.keys && <kbd>{e.keys}</kbd>}
        </li>
      ))}
    </ListPopup>
  );
}
