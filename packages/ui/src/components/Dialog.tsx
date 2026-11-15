import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
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
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const first =
      root?.querySelector<HTMLElement>('[data-autofocus]') ??
      root?.querySelector<HTMLElement>('input, select, textarea, button');
    first?.focus();
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
      <div class={`tk-dialog ${props.class ?? ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <form
          ref={ref}
          autocomplete="off"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              props.onClose();
            } else if (ref.current) {
              trapTab(ref.current, e);
            }
          }}
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
