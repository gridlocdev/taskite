import { isComposingKey, isSubmitKey } from '@taskite/ui';
import type { AppController } from './controller.ts';

/** Takes the keyboard once, when the field appears, with the caret after the name. */
function focusAtEnd(field: HTMLInputElement | null): void {
  if (!field) return;
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}

/**
 * A task's name as a text field in its row (PRD §4.4). Enter saves, Esc puts the name back, ⌘Enter saves and
 * opens the task editor, and a click elsewhere saves. The text lives in the controller, so switching to another
 * window or tab keeps the field open with what was typed, and the keyboard comes back to it.
 */
export function NameField({ app, title }: { readonly app: AppController; readonly title: string }) {
  const r = app.renaming.value;
  if (!r) return null;
  // Until something is typed, a rename made elsewhere shows here.
  const value = r.text === r.from ? title : r.text;
  return (
    <input
      ref={focusAtEnd}
      class="tk-row-title tk-name-field"
      value={value}
      aria-label="Task name"
      spellcheck={true}
      onInput={(e) => app.typeName((e.target as HTMLInputElement).value)}
      onKeyDown={(e) => {
        if (isComposingKey(e)) return;
        if (isSubmitKey(e)) {
          e.preventDefault();
          e.stopPropagation();
          app.edit(r.id);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          app.endRename();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          app.endRename({ save: false });
        }
      }}
      onBlur={() => {
        // The window or tab lost focus (⌘Tab, another tab): keep editing; the browser gives the keyboard back.
        if (!document.hasFocus()) return;
        app.endRename({ focus: false });
      }}
    />
  );
}
