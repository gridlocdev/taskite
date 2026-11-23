/** How wide a stack of dragged tasks is at most, so it reads as a bundle and the drop line shows beside it. */
const STACK_WIDTH = 360;
/** How far each card behind the top one sits down and to the right. */
const STEP = 6;
/** Room above the stack for its count. */
const BADGE_ROOM = 12;

/**
 * Drags a faint copy of `row` instead of the browser's own snapshot, which is too solid to see the drop line
 * through. With more than one task (`count`), the copy sits on a stack of cards with "N tasks" on it, and the
 * other chosen rows fade while they're carried (PRD §4.5). The copy has to be in the page when the drag
 * starts, so it waits off-screen, outside the app's own elements, until the drag ends. Its wrapper keeps a
 * board card's look. A drop can redraw the row away before it hears dragend, so the window's drop takes the
 * copy away too, and so does the next drag.
 */
export function setFaintDragImage(e: DragEvent, row: HTMLElement, count = 1): void {
  if (!e.dataTransfer) return;
  const ghost = row.cloneNode(true) as HTMLElement;
  ghost.classList.remove('tk-chosen', 'tk-drop-before', 'tk-drop-after');
  ghost.removeAttribute('role');
  ghost.removeAttribute('data-id');
  for (const old of document.querySelectorAll('.tk-drag-holder')) old.remove();
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.className = row.closest('.tk-board') ? 'tk-drag-holder tk-board' : 'tk-drag-holder';
  const r = row.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const root = document.documentElement;
  if (count > 1) {
    const width = Math.min(row.offsetWidth, STACK_WIDTH);
    const stack = document.createElement('div');
    stack.className = 'tk-drag-stack';
    stack.style.width = `${width + 2 * STEP}px`;
    stack.style.paddingTop = `${BADGE_ROOM}px`;
    for (let i = Math.min(count - 1, 2); i >= 1; i--) {
      const sheet = document.createElement('div');
      sheet.className = 'tk-drag-sheet';
      Object.assign(sheet.style, {
        top: `${BADGE_ROOM + i * STEP}px`,
        left: `${i * STEP}px`,
        width: `${width}px`,
        height: `${row.offsetHeight}px`,
      });
      stack.append(sheet);
    }
    ghost.style.width = `${width}px`;
    stack.append(ghost);
    const badge = document.createElement('span');
    badge.className = 'tk-drag-count';
    badge.textContent = `${count} tasks`;
    stack.append(badge);
    holder.append(stack);
    document.body.append(holder);
    e.dataTransfer.setDragImage(stack, Math.min(x, width - 1), y + BADGE_ROOM);
    root.classList.add('tk-dragging-many');
  } else {
    ghost.classList.add('tk-drag-ghost');
    ghost.style.width = `${row.offsetWidth}px`;
    holder.append(ghost);
    document.body.append(holder);
    e.dataTransfer.setDragImage(ghost, x, y);
  }
  const done = (): void => {
    holder.remove();
    root.classList.remove('tk-dragging-many');
  };
  row.addEventListener('dragend', done, { once: true });
  window.addEventListener('drop', done, { once: true, capture: true });
}
