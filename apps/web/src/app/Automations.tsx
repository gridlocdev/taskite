import { useId, useState } from 'preact/hooks';
import { MAX_ACTIONS, MAX_RULES, plural, type AutomationTrigger, type Priority } from '@taskite/core';
import { Dialog, Icon } from '@taskite/ui';
import {
  ACTION_NAMES,
  DUE_NAMES,
  TRIGGER_NAMES,
  dueDays,
  enterRulesChanged,
  fromDrafts,
  newAction,
  newRule,
  placeKey,
  toDrafts,
  type ActionDraft,
  type ActionKind,
  type DueChoice,
  type RuleDraft,
} from './automationForm.ts';
import type { AppController } from './controller.ts';

const PRIORITIES: readonly Priority[] = [1, 2, 3, 4];

/**
 * Section Automations… (PRD §6.1): each rule a sentence, "When a task [enters this section] then [actions]".
 * Cancel or Esc discards; Save keeps every rule as one undo step, first asking whether to apply new "enters"
 * rules to the tasks already in the section.
 */
export function AutomationsDialog({
  app,
  projectId,
  sectionId,
}: {
  readonly app: AppController;
  readonly projectId: string;
  readonly sectionId: string;
}) {
  const section = app.list.getSection(projectId, sectionId);
  const places = app.list.data.projects.flatMap((p) => [
    { key: placeKey(p.id, null), name: p.name },
    ...(p.sections ?? []).map((s) => ({ key: placeKey(p.id, s.id), name: `${p.name} › ${s.name}` })),
  ]);
  const here = placeKey(projectId, sectionId);
  const firstPlace = places.find((p) => p.key !== here)?.key ?? here;
  const [rules, setRules] = useState<readonly RuleDraft[]>(() =>
    toDrafts(section?.automations ?? [], firstPlace),
  );
  /** How many tasks the "Apply to the tasks already here?" question is about, once Save asks it. */
  const [asking, setAsking] = useState<number | null>(null);
  const labelsId = useId();

  if (!section) return null;

  const setRule = (at: number, rule: RuleDraft) => setRules(rules.map((r, i) => (i === at ? rule : r)));
  const setAction = (rule: number, at: number, action: ActionDraft) => {
    const r = rules[rule]!;
    setRule(rule, { ...r, actions: r.actions.map((a, i) => (i === at ? action : a)) });
  };
  const save = (apply: boolean) => {
    app.close();
    app.saveAutomations(projectId, sectionId, fromDrafts(rules), apply);
  };

  if (asking !== null)
    return (
      // Its own key, so it opens as a new dialog and the keyboard lands on Apply.
      <Dialog
        key="apply"
        title={`Automations · ${section.name}`}
        onClose={() => app.close()}
        actions={
          <>
            <button type="button" class="tk-button" onClick={() => save(false)}>
              Not now
            </button>
            <button
              type="button"
              class="tk-button tk-button-primary"
              data-autofocus
              onClick={() => save(true)}
            >
              Apply
            </button>
          </>
        }
      >
        <p>
          Apply to the {plural(asking, 'task')} already in {section.name}?
        </p>
      </Dialog>
    );

  return (
    <Dialog
      title={`Automations · ${section.name}`}
      class="tk-dialog-wide tk-automations"
      onClose={() => app.close()}
      onSubmit={() => {
        const saved = fromDrafts(rules);
        const open = app.list.openTasksIn(projectId, sectionId).length;
        if (open && enterRulesChanged(section.automations ?? [], saved)) setAsking(open);
        else save(false);
      }}
      actions={
        <>
          <button type="button" class="tk-button" onClick={() => app.close()}>
            Cancel
          </button>
          <button type="submit" class="tk-button tk-button-primary">
            Save
          </button>
        </>
      }
    >
      {rules.length === 0 && (
        <p class="tk-muted">
          No automations yet. A rule changes a task when it enters this section, leaves it, or is completed
          here.
        </p>
      )}
      <datalist id={labelsId}>
        {app.list.getLabels().map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      {rules.map((rule, r) => (
        <fieldset key={r} class="tk-rule" aria-label={`Rule ${r + 1}`}>
          <div class="tk-rule-line">
            <span>When a task</span>
            <select
              aria-label={`Rule ${r + 1} trigger`}
              value={rule.on}
              onChange={(e) =>
                setRule(r, { ...rule, on: (e.target as HTMLSelectElement).value as AutomationTrigger })
              }
            >
              {(Object.keys(TRIGGER_NAMES) as AutomationTrigger[]).map((on) => (
                <option key={on} value={on}>
                  {TRIGGER_NAMES[on]}
                </option>
              ))}
            </select>
            <span>then</span>
            <button
              type="button"
              class="tk-icon-button tk-push-right"
              aria-label={`Remove rule ${r + 1}`}
              title="Remove rule"
              onClick={() => setRules(rules.filter((_, i) => i !== r))}
            >
              <Icon name="trash" />
            </button>
          </div>
          <ul class="tk-rule-actions">
            {rule.actions.map((action, a) => (
              <li key={a} class="tk-rule-line">
                <ActionFields
                  action={action}
                  name={`Rule ${r + 1} action ${a + 1}`}
                  places={places}
                  labelsId={labelsId}
                  onChange={(next) => setAction(r, a, next)}
                />
                <button
                  type="button"
                  class="tk-icon-button tk-push-right"
                  aria-label={`Remove rule ${r + 1} action ${a + 1}`}
                  title="Remove action"
                  onClick={() => setRule(r, { ...rule, actions: rule.actions.filter((_, i) => i !== a) })}
                >
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
          {rule.actions.length < MAX_ACTIONS && (
            <button
              type="button"
              class="tk-button tk-button-quiet"
              onClick={() => setRule(r, { ...rule, actions: [...rule.actions, newAction(firstPlace)] })}
            >
              <Icon name="plus" /> Add action
            </button>
          )}
        </fieldset>
      ))}
      {rules.length < MAX_RULES && (
        <button
          type="button"
          class="tk-button tk-button-quiet"
          data-autofocus={rules.length === 0 ? '' : undefined}
          onClick={() => setRules([...rules, newRule(firstPlace)])}
        >
          <Icon name="plus" /> Add rule
        </button>
      )}
    </Dialog>
  );
}

/** One action: what it does, then its value (a date, a priority, a label or a place). */
function ActionFields(props: {
  readonly action: ActionDraft;
  readonly name: string;
  readonly places: readonly { readonly key: string; readonly name: string }[];
  readonly labelsId: string;
  readonly onChange: (action: ActionDraft) => void;
}) {
  const { action, name, onChange } = props;
  const value = (e: Event) => (e.target as HTMLSelectElement | HTMLInputElement).value;
  const badDays = action.kind === 'due' && action.due === 'days' && dueDays(action.days) === undefined;
  return (
    <>
      <select
        aria-label={name}
        value={action.kind}
        onChange={(e) => onChange({ ...action, kind: value(e) as ActionKind })}
      >
        {(Object.keys(ACTION_NAMES) as ActionKind[]).map((kind) => (
          <option key={kind} value={kind}>
            {ACTION_NAMES[kind]}
          </option>
        ))}
      </select>
      {action.kind === 'due' && (
        <select
          aria-label={`${name} date`}
          value={action.due}
          onChange={(e) => onChange({ ...action, due: value(e) as DueChoice })}
        >
          {(Object.keys(DUE_NAMES) as DueChoice[]).map((due) => (
            <option key={due} value={due}>
              {DUE_NAMES[due]}
            </option>
          ))}
        </select>
      )}
      {action.kind === 'due' && action.due === 'days' && (
        <input
          class="tk-rule-days"
          type="number"
          min={1}
          max={365}
          aria-label={`${name} days`}
          aria-invalid={badDays || undefined}
          value={action.days}
          onInput={(e) => onChange({ ...action, days: value(e) })}
        />
      )}
      {action.kind === 'priority' && (
        <select
          aria-label={`${name} priority`}
          value={String(action.priority)}
          onChange={(e) => onChange({ ...action, priority: Number(value(e)) as Priority })}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={String(p)}>
              Priority {p}
            </option>
          ))}
        </select>
      )}
      {(action.kind === 'addLabel' || action.kind === 'removeLabel') && (
        <input
          aria-label={`${name} label`}
          placeholder="label"
          list={props.labelsId}
          value={action.label}
          onInput={(e) => onChange({ ...action, label: value(e) })}
        />
      )}
      {action.kind === 'moveTo' && (
        <select
          aria-label={`${name} place`}
          value={action.place}
          onChange={(e) => onChange({ ...action, place: value(e) })}
        >
          {props.places.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </>
  );
}
