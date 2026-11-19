// Fills www (Capacitor's webDir) with the web client's build and adds the bridge script ahead of the client's
// module script, so `window.taskiteNative` exists before Taskite starts.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const BRIDGE = 'taskite-ios-bridge.js';
const app = new URL('../', import.meta.url);
const www = new URL('www/', app);

rmSync(www, { recursive: true, force: true });
cpSync(new URL('../web/dist/', app), www, { recursive: true });
cpSync(new URL(`dist/${BRIDGE}`, app), new URL(BRIDGE, www));

const index = new URL('index.html', www);
const html = readFileSync(index, 'utf8');
const at = html.indexOf('<script type="module"');
if (at < 0) throw new Error("The web client's index.html has no module script to put the bridge before.");
writeFileSync(index, `${html.slice(0, at)}<script src="./${BRIDGE}"></script>\n    ${html.slice(at)}`);
