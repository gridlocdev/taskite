import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { isComposingKey } from '../commands/shortcut.ts';

/**
 * Where a key moves the highlight in a list of `count` items: ↓ and Tab go down, ↑ and Shift+Tab go up,
 * stopping at the ends. `undefined` for any other key.
 */
export function listStep(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  index: number,
  count: number,
): number | undefined {
  const tab = e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (e.key === 'ArrowDown' || (tab && !e.shiftKey)) return Math.max(0, Math.min(count - 1, index + 1));
  if (e.key === 'ArrowUp' || (tab && e.shiftKey)) return Math.max(0, index - 1);
  return undefined;
}

/**
 * A search field over a list (the command menu, Move to…): ↑ ↓ or Tab and Shift+Tab move, Enter picks,
 * Escape closes. The field is the only Tab stop, so focus can't leave it.
 */
export function ListPopup(props: {
  readonly label: string;
  readonly placeholder: string;
  readonly query: string;
  readonly onQuery: (q: string) => void;
  readonly index: number;
  readonly onIndex: (i: number) => void;
  readonly count: number;
  readonly onPick: (i: number) => void;
  readonly onClose: () => void;
  readonly children: ComponentChildren;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => {
      if (previous?.isConnected && previous !== document.body) previous.focus();
    };
  }, []);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [props.index]);
  const onKeyDown = (e: KeyboardEvent) => {
    // Keys that pick or cancel an input method's candidate belong to it.
    if (isComposingKey(e)) return;
    const step = listStep(e, props.index, props.count);
    if (step !== undefined) {
      e.preventDefault();
      props.onIndex(step);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (props.count > 0) props.onPick(props.index);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      props.onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };
  return (
    <div
      class="tk-backdrop tk-backdrop-top"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div class="tk-dialog tk-palette" role="dialog" aria-modal="true" aria-label={props.label}>
        <input
          ref={input}
          value={props.query}
          placeholder={props.placeholder}
          onInput={(e) => props.onQuery((e.target as HTMLInputElement).value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls="tk-palette-list"
          aria-activedescendant={props.count ? `tk-palette-${props.index}` : undefined}
          spellcheck={false}
        />
        <ul ref={list} id="tk-palette-list" role="listbox" aria-label={props.label}>
          {props.children}
        </ul>
        {props.count === 0 && <p class="tk-palette-empty">No matches</p>}
      </div>
    </div>
  );
}
