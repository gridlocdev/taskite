import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { isComposingKey, isSubmitKey, isUndoKey } from '../commands/shortcut.ts';
import { trapTab } from './focusTrap.ts';

/**
 * The one modal dialog: labelled by its title, Escape and a click on the backdrop close it, ⌘Enter (Ctrl+Enter)
 * submits it from any field, Tab stays inside it, focus moves in when it opens and goes back where it was when it closes.
 */
export function Dialog(props: {
  readonly title: string;
  readonly onClose: () => void;
  readonly class?: string;
  readonly children: ComponentChildren;
  readonly actions?: ComponentChildren;
  readonly onSubmit?: () => void;
  /** While this returns true, ⌘Z and ⇧⌘Z go on to the app's Undo and Redo instead of stopping here. */
  readonly passUndo?: () => boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const titleId = useId();
  // Taken while rendering: the body's own effects run first and may already have moved focus inside.
  const [previous] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    const root = ref.current;
    // A finger: no keyboard popping up over the dialog until a field is tapped, so the box itself takes focus.
    const finger = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const first =
      root?.querySelector<HTMLElement>('[data-autofocus]') ??
      (finger
        ? root?.closest<HTMLElement>('.tk-dialog')
        : root?.querySelector<HTMLElement>('input, select, textarea, button'));
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
          } else if (props.onSubmit && isSubmitKey(e)) {
            e.preventDefault();
            e.stopPropagation();
            ref.current?.requestSubmit();
          } else if (isUndoKey(e) && !keepsOwnUndo(e.target) && !props.passUndo?.()) {
            // The browser's own undo would take back typing in a field behind the dialog, and move the keyboard
            // there. A text field in the dialog keeps its undo.
            e.preventDefault();
            e.stopPropagation();
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

/** Input types that hold typed text, so ⌘Z in them undoes typing. A radio or checkbox has none. */
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

function keepsOwnUndo(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return TEXT_INPUTS.has(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}
