import { Icon } from '@taskite/ui';
import type { AppController } from './controller.ts';

const STATUS_TEXT = { saved: '', saving: 'Saving…', failed: 'Not saved', conflict: 'Not saved' } as const;

/** The status bar: the latest notice with its action, and the save state (PRD §5.5). */
export function StatusBar({ app }: { readonly app: AppController }) {
  const notice = app.notice.value;
  const status = app.session.status.value;
  return (
    <footer class="tk-status">
      <div class={`tk-notice${notice?.tone === 'error' ? ' tk-notice-error' : ''}`}>
        {notice && (
          <>
            <span>{notice.text}</span>
            {notice.action && (
              <button
                type="button"
                class="tk-link-button"
                onClick={() => {
                  const run = notice.action!.run;
                  app.dismissNotice();
                  run();
                }}
              >
                {notice.action.label}
              </button>
            )}
            {notice.sticky && (
              <button
                type="button"
                class="tk-icon-button tk-small"
                aria-label="Dismiss"
                onClick={() => app.dismissNotice()}
              >
                <Icon name="x" />
              </button>
            )}
          </>
        )}
      </div>
      <span class={`tk-save tk-save-${status}`}>{STATUS_TEXT[status]}</span>
      <div class="tk-live" role="status" aria-live="polite" aria-atomic="true">
        {app.announcement.value}
      </div>
    </footer>
  );
}
