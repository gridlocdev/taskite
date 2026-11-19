// Architecture rules, checked on every `just check`. Each failure says what to do instead.
// Copy to test/architecture.test.ts, fill in the settings below, then run `just arch-baseline` once in an
// existing app. Two lists keep the rules honest. Each maps a finding to how many times it happens, since a key
// names a file and not a line:
//   test/architecture-baseline.json    old violations. New ones fail (a higher count too), and so do entries that
//                                      happen less often, so the list only shrinks. Never add to it.
//   test/architecture-exceptions.json  deliberate exceptions, each with its reason in the key (an ignored
//                                      error, an eslint-disable, a @ts-expect-error). Adding one needs the owner's yes.
// A comment is never permission: a rule broken "for a good reason" is listed here or fixed.
// Uses the TypeScript compiler API only (no new packages).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// ── Settings ──────────────────────────────────────────────────────────────

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASELINE = path.join(ROOT, 'test/architecture-baseline.json');
const EXCEPTIONS = path.join(ROOT, 'test/architecture-exceptions.json');

/** Each workspace part and the parts it may import. Imports point down only. */
const LAYERS: Record<string, readonly string[]> = {
  'packages/core': [],
  'packages/node-files': ['packages/core'],
  'packages/ui': ['packages/core'],
  'apps/web': ['packages/ui', 'packages/core'],
  'apps/server': ['packages/core', 'packages/node-files'],
  'apps/cli': ['packages/core', 'packages/node-files'],
  'apps/desktop': ['packages/core', 'packages/node-files'],
  'apps/ios': ['packages/ui', 'packages/core'],
};

/**
 * The pure engine packages: no DOM, Node or Preact in their source. Their tests run in Node and may read
 * fixtures with node:fs and settings from process.env (randomOps.ts does), so the engine rules skip them.
 */
const ENGINE = ['packages/core'];
const ENGINE_BANNED = [/^node:/, /^preact/, /^@preact\//];
const ENGINE_BANNED_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'process',
];

/**
 * The names code calls fetch by. Add the name a store adapter gives a fetch passed in to it, so its calls need a
 * timeout too. Only the global `fetch` counts for the `fetch` rule.
 */
const FETCH_NAMES = ['fetch'];

/** The parts that run in the page. */
const RENDERER = ['packages/ui', 'apps/web', 'apps/ios'];

// Things the page may do only in the folders or files listed. The test fails on an entry that doesn't exist.
// Taskite keeps its settings in tasks.json, so only the store adapters touch browser storage.
const SHARED_DIALOGS = ['packages/ui/src/components/Dialog.tsx', 'packages/ui/src/components/ListPopup.tsx'];
const CONFINED: { rule: Rule; allowed: readonly string[] }[] = [
  { rule: 'fetch', allowed: ['packages/ui/src/store/'] },
  { rule: 'storage', allowed: ['packages/ui/src/store/'] },
  { rule: 'key-listener', allowed: ['packages/ui/src/commands/'] },
  { rule: 'timer', allowed: ['packages/ui/src/schedule.ts'] },
  { rule: 'effect', allowed: [...SHARED_DIALOGS, 'packages/ui/src/components/focusTrap.ts'] },
  { rule: 'dialog-role', allowed: SHARED_DIALOGS },
];

/**
 * Tests reach their own package through src/index.ts, like any other caller. On for a new app; in an existing
 * app whose tests import internals everywhere, set it to false rather than baselining hundreds of lines.
 */
const TESTS_USE_ENTRY_POINT = false;

/** Source files longer than this (lines) are doing too many jobs. */
const MAX_LINES = 600;

// ── What each rule asks for instead ───────────────────────────────────────

type Rule =
  | 'layer'
  | 'deep-import'
  | 'relative-import'
  | 'test-internal'
  | 'export-star'
  | 'engine-import'
  | 'engine-global'
  | 'deep-copy'
  | 'fetch'
  | 'fetch-timeout'
  | 'storage'
  | 'key-listener'
  | 'timer'
  | 'effect'
  | 'dialog-role'
  | 'native-dialog'
  | 'empty-catch'
  | 'swallowed-promise'
  | 'ignore-error'
  | 'lint-disable'
  | 'ts-suppress'
  | 'size';

const FIX: Record<Rule, string> = {
  layer: 'Move the code down to a part both can use, or pass it in from the app.',
  'deep-import': 'Import the package by name and export what you need from its src/index.ts.',
  'relative-import': 'Import the other part by its package name.',
  'test-internal':
    'Test it through the package entry point; if that is impossible, the module has the wrong shape.',
  'export-star': 'Name each export, so the package shows what it offers.',
  'engine-import':
    'Keep the engine pure: pass the platform piece in from the app, or move the code out of the engine.',
  'engine-global': 'Keep the engine pure: take the value as a parameter.',
  'deep-copy': 'Undo stores the changed items before and after, not a copy of the whole document.',
  fetch: 'Go through the store interface; only its adapters talk to the network.',
  'fetch-timeout':
    'Pass signal: AbortSignal.timeout(…), so a server that dropped off cannot leave the app saving forever.',
  storage: 'Keep documents in the store and preferences in the settings module.',
  'key-listener':
    'Add a command with a shortcut to the catalog; it handles focus, open dialogs and the native menu.',
  timer:
    'A timer usually patches over an ordering problem: change the model first and let the signals redraw; animations run after the edit. If something must wait, use the scheduler module.',
  effect:
    'Derive the value with computed(), or make the change in the model action that causes it. Effects that copy state are where stale copies come from.',
  'dialog-role':
    'Use the shared Dialog: it has the focus trap, Escape, the command gate and one dialog at a time.',
  'native-dialog':
    'Show a notice, or a Dialog for a real choice; alert and confirm block the page and the desktop app.',
  'empty-catch': 'Handle the error or return a value the caller checks (such as null).',
  'swallowed-promise':
    "Handle the error, or write ignoreError(promise, 'why') so it is listed as an exception.",
  'ignore-error': 'Ask the owner, then list it in test/architecture-exceptions.json, or handle the error.',
  'lint-disable':
    'Fix what the rule reports. If the rule is wrong here, ask the owner, then list it as an exception.',
  'ts-suppress': 'Fix the type. If that is truly impossible, ask the owner, then list it as an exception.',
  size: 'Split the file by job, each part behind a small interface.',
};

// ── Scanning ──────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'release', '.types', 'demo']);
const SOURCE = /\.(ts|tsx|mts|cts)$/;
const TIMERS = new Set(['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback']);
const NATIVE_DIALOGS = new Set(['alert', 'confirm', 'prompt']);
const EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect']);

interface Finding {
  /** Stable key for the lists: rule, file, and what it points at (no line numbers). */
  key: string;
  message: string;
  /** Exceptions are allowed when listed; violations are allowed only while in the baseline. */
  exception: boolean;
}

const parts = Object.keys(LAYERS);
const packageNames = new Map<string, string>();
for (const part of parts) {
  const manifest = path.join(ROOT, part, 'package.json');
  if (!existsSync(manifest)) continue;
  const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
  if (name) packageNames.set(name, part);
}

function partOf(repoPath: string): string | undefined {
  return parts.find((part) => repoPath === part || repoPath.startsWith(`${part}/`));
}

function listFiles(part: string): string[] {
  const dir = path.join(ROOT, part);
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => SOURCE.test(file) && !file.split('/').some((segment) => SKIP_DIRS.has(segment)))
    .map((file) => `${part}/${file}`);
}

function isTest(repoPath: string): boolean {
  return repoPath.includes('/test/');
}

class Report {
  readonly findings: Finding[] = [];
  private readonly file: string;
  private readonly source: ts.SourceFile;

  constructor(file: string, source: ts.SourceFile) {
    this.file = file;
    this.source = source;
  }

  line(node: ts.Node): number {
    return this.source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  }

  add(rule: Rule, detail: string | null, what: string, line: number | null, exception = false): void {
    const where = line === null ? this.file : `${this.file}:${line}`;
    this.findings.push({
      key: `${rule}: ${this.file}${detail ? ` -> ${detail}` : ''}`,
      message: `${where} ${what}. ${FIX[rule]}`,
      exception,
    });
  }
}

/** Every module specifier the file imports or re-exports, static or dynamic. */
function imports(source: ts.SourceFile): { spec: string; node: ts.Node }[] {
  const found: { spec: string; node: ts.Node }[] = [];
  const visit = (node: ts.Node) => {
    let spec: ts.Expression | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) spec = node.moduleSpecifier;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      spec = node.arguments[0];
    if (spec && ts.isStringLiteralLike(spec)) found.push({ spec: spec.text, node });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function checkImports(file: string, source: ts.SourceFile, report: Report): void {
  const part = partOf(file);
  if (!part) return;
  const engine = ENGINE.includes(part) && !isTest(file);
  for (const { spec, node } of imports(source)) {
    const line = report.line(node);
    if (engine && ENGINE_BANNED.some((pattern) => pattern.test(spec))) {
      report.add('engine-import', spec, `the engine imports ${spec}`, line);
      continue;
    }
    const scoped = [...packageNames].find(([name]) => spec === name || spec.startsWith(`${name}/`));
    if (scoped) {
      const [name, target] = scoped;
      if (spec !== name && !/\.(css|svg|png|json|woff2?)$/.test(spec)) {
        report.add('deep-import', spec, `imports ${spec} instead of ${name}`, line);
      }
      // Tests may use any part through its package name (a contract test runs against the server).
      if (!isTest(file) && target !== part && !LAYERS[part]?.includes(target)) {
        report.add('layer', target, `${part} imports ${target}`, line);
      }
      continue;
    }
    if (!spec.startsWith('.')) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    const target = partOf(resolved);
    if (target !== part) {
      report.add('relative-import', resolved, `reaches into ${target ?? resolved} by path`, line);
      continue;
    }
    const intoSrc = resolved.startsWith(`${part}/src/`);
    if (TESTS_USE_ENTRY_POINT && isTest(file) && intoSrc && resolved !== `${part}/src/index.ts`) {
      report.add('test-internal', resolved, `tests ${resolved} from inside`, line);
    }
  }
}

/** The called name: `f(…)`, `x.f(…)`, `window.f(…)`. */
function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

/** A call to a browser global, bare or through window/globalThis/self, that the file doesn't declare itself. */
function isGlobalCall(call: ts.CallExpression, declared: Set<string>): boolean {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return !declared.has(callee.text);
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    /^(window|globalThis|self)$/.test(callee.expression.text)
  );
}

/** `() => {}` or `() => undefined`. (`() => null` turns a failure into a value the caller checks, so it's allowed.) */
function isEmptyHandler(node: ts.Expression | undefined): boolean {
  if (!node || !(ts.isArrowFunction(node) || ts.isFunctionExpression(node))) return false;
  const body = node.body;
  if (ts.isBlock(body)) return body.statements.length === 0;
  return body.getText() === 'undefined' || body.getText() === 'void 0';
}

/** Names the file declares itself (parameters, variables, imports), which shadow globals of the same name. */
function declaredNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    const name = (node as { name?: ts.Node }).name;
    if (
      name &&
      ts.isIdentifier(name) &&
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isImportSpecifier(node) ||
        ts.isImportClause(node) ||
        ts.isNamespaceImport(node))
    ) {
      names.add(name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/** True when the identifier is a name, not a use: `x.document`, `{ document: … }`, a field or method name, a type. */
function isNamePosition(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isQualifiedName(parent) || ts.isTypeReferenceNode(parent)) return true;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
  return (parent as { name?: ts.Node }).name === node && !ts.isShorthandPropertyAssignment(parent);
}

function isGlobalUse(node: ts.Identifier, declared: Set<string>): boolean {
  return !declared.has(node.text) && !isNamePosition(node);
}

function stringArg(node: ts.Expression | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

/**
 * `fetch(url)` or `fetch(url, { … })` with no `signal`. A spread (`{ ...init }`) doesn't count as one: write
 * `signal` out. An options value built elsewhere can't be checked here; the store's contract test covers it.
 */
function fetchWithoutSignal(call: ts.CallExpression): boolean {
  const options = call.arguments[1];
  if (!options) return true;
  if (!ts.isObjectLiteralExpression(options)) return false;
  return !options.properties.some((p) => p.name && ts.isIdentifier(p.name) && p.name.text === 'signal');
}

function checkCode(file: string, source: ts.SourceFile, report: Report): void {
  const part = partOf(file) ?? '';
  const engine = ENGINE.includes(part) && !isTest(file);
  const renderer = RENDERER.includes(part);
  const test = isTest(file);
  const declared = declaredNames(source);
  const confined = (rule: Rule, node: ts.Node, what: string) => {
    const allowed = CONFINED.find((c) => c.rule === rule)?.allowed ?? [];
    if (test || !renderer || allowed.some((entry) => file.startsWith(entry))) return;
    report.add(rule, null, what, report.line(node));
  };

  // Local names of the effect hooks, from the imports (which come first). Each call counts, not the import.
  const effectNames = new Map<string, string>();

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (ts.isIdentifier(node.expression) && effectNames.has(node.expression.text)) {
        confined('effect', node, `uses ${effectNames.get(node.expression.text)}`);
      }
      const first = node.arguments[0];
      const globalFetch = name === 'fetch' && isGlobalCall(node, declared);
      if (globalFetch) confined('fetch', node, 'calls fetch');
      const anyFetch = globalFetch || (name !== 'fetch' && !!name && FETCH_NAMES.includes(name));
      if (anyFetch && !test && fetchWithoutSignal(node)) {
        report.add('fetch-timeout', null, `calls ${name} with no timeout`, report.line(node));
      }
      if (name && TIMERS.has(name) && isGlobalCall(node, declared)) confined('timer', node, `calls ${name}`);
      if (renderer && !test && name && NATIVE_DIALOGS.has(name) && isGlobalCall(node, declared)) {
        report.add('native-dialog', name, `calls ${name}()`, report.line(node));
      }
      if (name === 'addEventListener' && /^key(down|up)$/.test(stringArg(first) ?? '')) {
        confined('key-listener', node, `adds a ${stringArg(first)} listener`);
      }
      if (engine && !test && name === 'structuredClone' && isGlobalCall(node, declared)) {
        report.add('deep-copy', null, 'copies with structuredClone', report.line(node));
      }
      const swallows =
        name === 'catch' && ts.isPropertyAccessExpression(node.expression) && isEmptyHandler(first);
      if (swallows && !test) {
        report.add(
          'swallowed-promise',
          null,
          'drops a promise failure with .catch(() => {})',
          report.line(node),
        );
      }
      if (name === 'ignoreError' && !test) {
        const reason = stringArg(node.arguments[1]);
        if (reason?.trim())
          report.add('ignore-error', reason.trim(), `ignores an error ("${reason.trim()}")`, null, true);
        else
          report.add(
            'swallowed-promise',
            null,
            'calls ignoreError without a reason as a string literal',
            report.line(node),
          );
      }
    }
    if (
      ts.isImportDeclaration(node) &&
      /^(preact\/hooks|preact\/compat|react)$/.test(stringArg(node.moduleSpecifier) ?? '')
    ) {
      const named = node.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (EFFECT_HOOKS.has(imported)) effectNames.set(element.name.text, imported);
        }
      }
    }
    if (ts.isJsxAttribute(node) && node.name.getText() === 'role') {
      const value = node.initializer && ts.isStringLiteral(node.initializer) ? node.initializer.text : '';
      if (/^(dialog|alertdialog)$/.test(value))
        confined('dialog-role', node, `draws its own role="${value}"`);
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText() === 'dialog'
    ) {
      confined('dialog-role', node, 'draws its own <dialog>');
    }
    if (
      ts.isIdentifier(node) &&
      /^(localStorage|sessionStorage|indexedDB)$/.test(node.text) &&
      isGlobalUse(node, declared)
    ) {
      confined('storage', node, `uses ${node.text}`);
    }
    if (
      engine &&
      ts.isIdentifier(node) &&
      ENGINE_BANNED_GLOBALS.includes(node.text) &&
      isGlobalUse(node, declared)
    ) {
      report.add('engine-global', node.text, `the engine uses ${node.text}`, report.line(node));
    }
    if (ts.isCatchClause(node) && node.block.statements.length === 0 && !test) {
      report.add('empty-catch', null, 'has an empty catch block', report.line(node));
    }
    if (ts.isExportDeclaration(node) && !node.exportClause && node.moduleSpecifier) {
      report.add('export-star', null, 'uses export *', report.line(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // Suppression comments. A reason in the comment is not permission: the exception list is.
  source
    .getFullText()
    .split('\n')
    .forEach((text, index) => {
      const lint = /\/[/*]\s*eslint-disable(?:-next-line|-line)?\s+([^*\n]*?)(?:\s+--.*)?(?:\*\/|$)/.exec(
        text,
      );
      if (lint) {
        const rules = (lint[1] ?? '').trim() || 'every rule';
        report.add('lint-disable', rules, `turns off ${rules}`, index + 1, true);
      }
      const suppress = /@ts-(ignore|expect-error|nocheck)/.exec(text);
      if (suppress) report.add('ts-suppress', suppress[0], `uses ${suppress[0]}`, index + 1, true);
    });

  if (!test && source.getLineAndCharacterOfPosition(source.end).line + 1 > MAX_LINES) {
    report.add('size', null, `is over ${MAX_LINES} lines`, null);
  }
}

function scan(): Finding[] {
  const findings: Finding[] = [];
  for (const part of parts) {
    for (const file of listFiles(part)) {
      const text = readFileSync(path.join(ROOT, file), 'utf8');
      const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
      const report = new Report(file, source);
      checkImports(file, source, report);
      checkCode(file, source, report);
      findings.push(...report.findings);
    }
  }
  return findings;
}

// ── The lists ─────────────────────────────────────────────────────────────

// A key names a file, not a line, so each list keeps a count per key: a second violation of a rule in a file
// that's already in the baseline fails like any other new one.
type Counts = Map<string, number>;

function count(findings: Finding[]): Counts {
  const counts: Counts = new Map();
  for (const f of findings) counts.set(f.key, (counts.get(f.key) ?? 0) + 1);
  return counts;
}

function readList(file: string): Counts {
  return new Map(
    existsSync(file) ? Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, number>) : [],
  );
}

function writeList(file: string, counts: Counts): void {
  const sorted = Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}

/** The findings past what the list allows for their key (all of them when the key isn't listed). */
function beyond(findings: Finding[], list: Counts): string[] {
  const counts = count(findings);
  return findings
    .filter((f) => (counts.get(f.key) ?? 0) > (list.get(f.key) ?? 0))
    .map((f) => `${f.message} (${counts.get(f.key)} found, ${list.get(f.key) ?? 0} listed)`);
}

/** Listed entries that now happen less often than listed. */
function stale(list: Counts, findings: Finding[]): string[] {
  const counts = count(findings);
  return [...list]
    .filter(([key, n]) => (counts.get(key) ?? 0) < n)
    .map(([key, n]) => `${key} (listed ${n}, found ${counts.get(key) ?? 0})`);
}

describe('architecture', () => {
  const found = scan();
  const violations = found.filter((f) => !f.exception);
  const exceptions = found.filter((f) => f.exception);

  if (process.env.ARCH_BASELINE === 'write') {
    it('writes the baseline and the exception list', () => {
      // Once only: written again later, the lists would quietly accept every new violation and exception.
      expect(existsSync(BASELINE), 'The baseline exists and only shrinks. Fix the violation instead.').toBe(
        false,
      );
      writeList(BASELINE, count(violations));
      writeList(EXCEPTIONS, count(exceptions));
    });
    return;
  }

  const baseline = readList(BASELINE);
  const allowed = readList(EXCEPTIONS);
  it('finds the workspace parts', () => {
    expect(packageNames.size).toBeGreaterThan(0);
  });

  it("allows only files and folders that exist (set CONFINED to the app's real ones)", () => {
    const entries = CONFINED.flatMap((c) => c.allowed.map((entry) => `${c.rule}: ${entry}`));
    expect(entries.filter((e) => !existsSync(path.join(ROOT, e.slice(e.indexOf(': ') + 2))))).toEqual([]);
  });

  it('has no new violations', () => {
    expect(beyond(violations, baseline)).toEqual([]);
  });

  it('has no exceptions the owner has not agreed to (test/architecture-exceptions.json)', () => {
    expect(beyond(exceptions, allowed)).toEqual([]);
  });

  it('lists nothing that happens less often now (lower or delete these entries in the baseline or the exception list)', () => {
    expect([...stale(baseline, violations), ...stale(allowed, exceptions)]).toEqual([]);
  });
});
