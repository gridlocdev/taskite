/**
 * Drags a faint copy of `row` instead of the browser's own snapshot, which is too solid to see the drop line
 * through. The copy has to be in the page when the drag starts, so it waits off-screen, outside the app's own
 * elements, until the drag ends. Its wrapper keeps a board card's look. A drop can redraw the row away before
 * it hears dragend, so the window's drop takes the copy away too, and so does the next drag.
 */
export function setFaintDragImage(e: DragEvent, row: HTMLElement): void {
  if (!e.dataTransfer) return;
  const ghost = row.cloneNode(true) as HTMLElement;
  ghost.classList.remove('tk-chosen', 'tk-drop-before', 'tk-drop-after');
  ghost.classList.add('tk-drag-ghost');
  ghost.removeAttribute('role');
  ghost.removeAttribute('data-id');
  ghost.style.width = `${row.offsetWidth}px`;
  for (const old of document.querySelectorAll('.tk-drag-holder')) old.remove();
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.className = row.closest('.tk-board') ? 'tk-drag-holder tk-board' : 'tk-drag-holder';
  holder.append(ghost);
  document.body.append(holder);
  const r = row.getBoundingClientRect();
  e.dataTransfer.setDragImage(ghost, e.clientX - r.left, e.clientY - r.top);
  const done = (): void => holder.remove();
  row.addEventListener('dragend', done, { once: true });
  window.addEventListener('drop', done, { once: true, capture: true });
}
