import { expect } from 'vitest';
import type { AppData } from '../../src/index.ts';

/**
 * The rules that relate tasks (PRD §4.4, §6): a live subtask has a live, top-level parent and sits in its
 * parent's project and section; a live task's section exists in its project.
 */
export function checkInvariants(data: AppData): void {
  for (const project of data.projects)
    for (const section of project.sections ?? []) {
      if (!('automations' in section)) continue;
      const rules = section.automations ?? [];
      expect(rules.length, `${section.name} keeps automations only while it has some`).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule.do.length, `a rule in ${section.name} has an action`).toBeGreaterThan(0);
        for (const action of rule.do) {
          if (!('moveTo' in action)) continue;
          const { projectId, sectionId } = action.moveTo;
          const to = data.projects.find((p) => p.id === projectId);
          expect(to, `a rule in ${section.name} moves to a project that exists`).toBeDefined();
          if (sectionId)
            expect(
              to?.sections?.some((s) => s.id === sectionId),
              `a rule in ${section.name} moves to a section that exists`,
            ).toBe(true);
        }
      }
    }
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  for (const t of data.tasks) {
    if (t.deletedAt !== null) continue;
    const project = data.projects.find((p) => p.id === t.projectId);
    expect(project, `${t.title} is in a project that exists`).toBeDefined();
    if (t.sectionId)
      expect(
        project?.sections?.some((s) => s.id === t.sectionId),
        `${t.title}'s section exists`,
      ).toBe(true);
    if (!t.parentId) continue;
    const parent = byId.get(t.parentId);
    expect(parent, `${t.title}'s parent exists`).toBeDefined();
    if (!parent) continue;
    expect(parent.parentId, `${t.title}'s parent is top-level`).toBeNull();
    expect(parent.deletedAt, `${t.title}'s parent is live`).toBeNull();
    expect(t.projectId, `${t.title} is in its parent's project`).toBe(parent.projectId);
    expect(t.sectionId, `${t.title} is in its parent's section`).toBe(parent.sectionId);
  }
}
