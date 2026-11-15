import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { isComposingKey } from '../commands/shortcut.ts';
import { trapTab } from './focusTrap.ts';

/**
 * The one modal dialog: labelled by its title, Escape and a click on the backdrop close it, Tab stays
 * inside it, focus moves in when it opens and goes back where it was when it closes.
 */
export function Dialog(props: {
  readonly title: string;
  readonly onClose: () => void;
  readonly class?: string;
  readonly children: ComponentChildren;
  readonly actions?: ComponentChildren;
  readonly onSubmit?: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const titleId = useId();
  // Taken while rendering: the body's own effects run first and may already have moved focus inside.
  const [previous] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    const root = ref.current;
    const first =
      root?.querySelector<HTMLElement>('[data-autofocus]') ??
      root?.querySelector<HTMLElement>('input, select, textarea, button');
    if (!root?.contains(document.activeElement)) first?.focus();
    return () => {
      if (previous?.isConnected && previous !== document.body) previous.focus();
    };
  }, []);
  return (
    <div
      class="tk-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      {/* Keys are handled on the whole box (focusable, so a click on empty space keeps focus in it). */}
      <div
        class={`tk-dialog ${props.class ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (isComposingKey(e)) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            props.onClose();
          } else if (ref.current) {
            trapTab(ref.current, e);
          }
        }}
      >
        <form
          ref={ref}
          autocomplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            props.onSubmit?.();
          }}
        >
          <h2 id={titleId}>{props.title}</h2>
          <div class="tk-dialog-body">{props.children}</div>
          {props.actions && <div class="tk-dialog-actions">{props.actions}</div>}
        </form>
      </div>
    </div>
  );
}
