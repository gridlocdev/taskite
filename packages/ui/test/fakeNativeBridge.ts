import {
  readAttachment,
  readDataFile,
  removeUnusedAttachments,
  writeAttachment,
  writeCopy,
  writeDataFile,
} from '@taskite/node-files';
import path from 'node:path';
import type { NativeData } from '../src/index.ts';

/** The desktop bridge's data calls, done the way the main process does them, on a real file. */
export function fakeNativeBridge(file: string, legacyFile?: string): NativeData {
  return {
    async load() {
      const own = await readDataFile(file);
      if (own.text === null && legacyFile) {
        const old = await readDataFile(legacyFile);
        if (old.text !== null) return { text: old.text, version: null, path: file, legacy: true };
      }
      return { ...own, path: file, legacy: false };
    },
    async save(text, expected) {
      const r = await writeDataFile(file, text, expected);
      return r.ok ? { ok: true, version: r.version } : { ok: false, reason: 'conflict' };
    },
    async saveCopy(text, label) {
      return path.basename(await writeCopy(file, text, label));
    },
    putFile: (id, bytes) => writeAttachment(file, id, bytes),
    getFile: (id) => readAttachment(file, id),
    cleanFiles: () => removeUnusedAttachments(file),
  };
}
