import { describeRule, plural, type Section } from '@taskite/core';
import { Icon, type CommandCatalog } from '@taskite/ui';
import type { AppController, MenuTarget } from './controller.ts';
import { openMenu } from './ContextMenu.tsx';

/**
 * A section's heading in a list or a board column: its name and count, ⚡ with the rule count when it has
 * automations, and, for a project section, the ⋯ and right-click menu.
 */
export function SectionHeading({
  app,
  catalog,
  section,
  heading,
  target,
}: {
  readonly app: AppController;
  readonly catalog: CommandCatalog;
  readonly section: Section;
  readonly heading: string;
  /** The project section, when it is one: what its menu and automations belong to. */
  readonly target: Extract<MenuTarget, { kind: 'section' }> | undefined;
}) {
  const rules = target ? (app.list.getSection(target.projectId, target.id)?.automations ?? []) : [];
  const sectionMenu = (e: MouseEvent, at?: { x: number; y: number }) =>
    target && openMenu(app, catalog, e, 'section', target, at);
  return (
    <h2
      class={`tk-section-heading${section.tone === 'overdue' ? ' tk-overdue' : ''}`}
      onContextMenu={(e) => {
        if (!target) return;
        e.stopPropagation();
        sectionMenu(e);
      }}
    >
      <span class="tk-section-name">{heading}</span>
      {section.count !== null && <span class="tk-count">{section.count}</span>}
      {target && rules.length > 0 && (
        // ⚡ and the rule count; hovering lists the rules, a click opens the editor (PRD §6.1).
        <button
          type="button"
          class="tk-automation-badge"
          aria-label={`${heading} automations: ${plural(rules.length, 'rule')}`}
          title={rules.map((rule) => describeRule(app.list, target.projectId, rule)).join('\n')}
          onClick={() => app.open({ kind: 'automations', projectId: target.projectId, sectionId: target.id })}
        >
          <Icon name="zap" />
          {rules.length}
        </button>
      )}
      {target && (
        <button
          type="button"
          class="tk-icon-button tk-section-more"
          aria-label={`${heading} section actions`}
          title="Section actions"
          aria-haspopup="menu"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            sectionMenu(e, { x: r.left, y: r.bottom + 4 });
          }}
        >
          <Icon name="dots" />
        </button>
      )}
    </h2>
  );
}
