import {
  deleteWorkspaceFolder,
  readAttachment,
  readDataFile,
  removeUnusedAttachments,
  restoreWorkspaceFolder,
  workspaceFile,
  workspaceListFile,
  writeAttachment,
  writeCopy,
  writeDataFile,
} from '@taskite/node-files';
import path from 'node:path';
import type { NativeData } from '../src/index.ts';

/** The desktop bridge's data calls, done the way the main process does them, on real files. */
export function fakeNativeBridge(file: string, legacyFile?: string): NativeData {
  const at = (workspace: string) => workspaceFile(file, workspace);
  return {
    async load(workspace) {
      const own = await readDataFile(at(workspace));
      if (own.text === null && legacyFile && workspace === 'main') {
        const old = await readDataFile(legacyFile);
        if (old.text !== null) return { text: old.text, version: null, path: file, legacy: true };
      }
      return { ...own, path: at(workspace), legacy: false };
    },
    async save(workspace, text, expected) {
      const r = await writeDataFile(at(workspace), text, expected);
      return r.ok ? { ok: true, version: r.version } : { ok: false, reason: 'conflict' };
    },
    async saveCopy(workspace, text, label) {
      return path.basename(await writeCopy(at(workspace), text, label));
    },
    putFile: (workspace, id, bytes) => writeAttachment(at(workspace), id, bytes),
    getFile: (workspace, id) => readAttachment(at(workspace), id),
    cleanFiles: (workspace) => removeUnusedAttachments(at(workspace)),
    loadWorkspaces: () => readDataFile(workspaceListFile(file)),
    async saveWorkspaces(text, expected) {
      const r = await writeDataFile(workspaceListFile(file), text, expected);
      return r.ok ? { ok: true, version: r.version } : { ok: false, reason: 'conflict' };
    },
    deleteWorkspace: (workspace, stamp) => deleteWorkspaceFolder(file, workspace, stamp),
    restoreWorkspace: (workspace, stamp) => restoreWorkspaceFolder(file, workspace, stamp),
  };
}
