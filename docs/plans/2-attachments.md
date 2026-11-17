# Attachments (PRD §4.8)

Each slice leaves `just check` green and fits one session.

- [x] **1. Engine model.** `attachments` on `Task`: the type, reading (drop entries without a UUID id or a name; left out when empty), writing, `addAttachments` and `removeAttachment` as undo steps that change nothing when nothing changes, and `attachmentIds(data)` for every id a task names, the Trash included. Unit tests and a random-operation seed.
- [x] **2. Store files.** `putFile(id, bytes)`, `getFile(id)` and `cleanFiles()` (which reads the store's own tasks file to see which files are used) on the store interface, in every adapter: memory, browser (OPFS `attachments/`), native (Electron bridge, writes atomically, ids checked as UUIDs in main), NAS (`PUT`/`GET /api/attachments/<id>` on the server and the client). The store contract test covers all four; a server test covers the limits and bad ids. Waits on nothing.
- [x] **3. Clean up on load.** After a load, the app and the CLI remove files no task names that are over a day old. Tests for the Trash, Delete Forever then Undo, and files that aren't ids. Waits on 1 and 2.
- [x] **4. Editor.** The Attachments button in the editor's row (file picker, drop on the editor), the list with name, size, open and ×, the 25 MB limit and the failed-write notice. The paperclip chip on rows and cards. `docs/features.md`, an e2e scenario with a screenshot. Waits on 1 and 2.
- [x] **5. CLI.** `taskite attach` and `taskite attachments`, with `--json`. Waits on 1 and 2.
