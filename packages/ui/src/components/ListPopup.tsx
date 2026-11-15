import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

/**
 * A search field over a list (the command menu, Move to…): ↑ ↓ move, Enter picks, Escape closes. The field
 * is the only Tab stop, so focus can't leave it.
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
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      props.onIndex(Math.min(props.count - 1, props.index + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      props.onIndex(Math.max(0, props.index - 1));
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
