import { useEffect, useRef, useState } from 'preact/hooks';
import { addDays, addMonths, firstDayOfWeek, monthGrid, parseISODate } from '@taskite/core';
import { Icon } from '@taskite/ui';

const WEEK_START = firstDayOfWeek();

/** Moves the focused day for a key, or null for a key the calendar doesn't use. */
function step(iso: string, key: string): string | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(iso, -1);
    case 'ArrowRight':
      return addDays(iso, 1);
    case 'ArrowUp':
      return addDays(iso, -7);
    case 'ArrowDown':
      return addDays(iso, 7);
    case 'PageUp':
      return addMonths(iso, -1);
    case 'PageDown':
      return addMonths(iso, 1);
    default:
      return null;
  }
}

/**
 * A month calendar for the due date dialog (PRD §4.4): today ringed, the chosen day filled. The week
 * starts where the system's locale starts it. Arrow keys move a day or a week, Page Up/Down a month;
 * Enter or a click picks the day.
 */
export function Calendar(props: {
  readonly today: string;
  readonly selected: string | null;
  readonly onPick: (iso: string) => void;
}) {
  const { today, selected } = props;
  const [focus, setFocus] = useState(selected ?? today);
  const grid = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  // Typing a date in the field shows its month.
  useEffect(() => {
    if (selected) setFocus(selected);
  }, [selected]);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  }, [focus]);
  const month = focus.slice(0, 7);
  const days = monthGrid(focus, WEEK_START);
  const heading = parseISODate(focus).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weekdays = days
    .slice(0, 7)
    .map((d) => parseISODate(d).toLocaleDateString(undefined, { weekday: 'narrow' }));
  const names = days
    .slice(0, 7)
    .map((d) => parseISODate(d).toLocaleDateString(undefined, { weekday: 'long' }));
  return (
    <div class="tk-calendar">
      <div class="tk-calendar-head">
        <button
          type="button"
          class="tk-icon-button"
          aria-label="Previous month"
          onClick={() => setFocus(addMonths(focus, -1))}
        >
          <Icon name="chevron-left" />
        </button>
        <span aria-live="polite">{heading}</span>
        <button
          type="button"
          class="tk-icon-button"
          aria-label="Next month"
          onClick={() => setFocus(addMonths(focus, 1))}
        >
          <Icon name="chevron-right" />
        </button>
      </div>
      <div
        ref={grid}
        class="tk-calendar-grid"
        role="grid"
        aria-label={heading}
        onKeyDown={(e) => {
          const next = step(focus, e.key);
          if (!next) return;
          e.preventDefault();
          e.stopPropagation();
          moved.current = true;
          setFocus(next);
        }}
      >
        <div role="row" class="tk-calendar-row">
          {weekdays.map((w, i) => (
            <abbr key={i} role="columnheader" title={names[i]} class="tk-calendar-weekday">
              {w}
            </abbr>
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((week) => (
          <div key={week} role="row" class="tk-calendar-row">
            {days.slice(week * 7, week * 7 + 7).map((d) => {
              const cls = [
                'tk-calendar-day',
                d.slice(0, 7) !== month && 'tk-calendar-other',
                d < today && 'tk-calendar-past',
                d === today && 'tk-calendar-today',
                d === selected && 'tk-calendar-selected',
                d === focus && 'tk-cursor',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  class={cls}
                  tabIndex={d === focus ? 0 : -1}
                  aria-selected={d === selected}
                  aria-current={d === today ? 'date' : undefined}
                  aria-label={parseISODate(d).toLocaleDateString(undefined, { dateStyle: 'full' })}
                  onClick={() => props.onPick(d)}
                  onFocus={() => d !== focus && setFocus(d)}
                >
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
