/**
 * ipc-guard.js — QA-M3: every IPC message must come from the app's own page.
 *
 * Electron security checklist item 17: validate the sender of every IPC message. The window
 * only ever loads app://ui, but a frame inside it (an iframe a future change might add, or a
 * page reached by a navigation bug) would otherwise reach every handler. The guard wraps
 * ipcMain once, so no handler has to remember the check:
 *   - the sending frame exists (it is null once the frame navigated away or was destroyed);
 *   - its origin is the app's own (origin, not URL: the Electron docs warn that the URL of
 *     about:blank, blob: and sandboxed documents does not say where they came from);
 *   - it is the top frame of its page, not a subframe.
 * A rejected `handle` call answers { error: 'untrusted-sender' }; a rejected `on` message is
 * dropped. Both are logged.
 */

function senderIsTrusted(event, trustedOrigin) {
  const frame = event && event.senderFrame;
  if (!frame || frame.origin !== trustedOrigin) return false;
  const sender = event.sender;
  return !!(sender && sender.mainFrame && frame === sender.mainFrame);
}

function createGuardedIpc(ipcMain, { trustedOrigin, log = () => {} }) {
  const reject = (channel, event) => {
    const frame = event && event.senderFrame;
    log(`ipc: rejected "${channel}" from ${frame ? JSON.stringify(frame.origin) : 'a gone frame'}`);
  };
  return {
    handle(channel, listener) {
      return ipcMain.handle(channel, (event, ...args) => {
        if (!senderIsTrusted(event, trustedOrigin)) { reject(channel, event); return { error: 'untrusted-sender' }; }
        return listener(event, ...args);
      });
    },
    on(channel, listener) {
      return ipcMain.on(channel, (event, ...args) => {
        if (!senderIsTrusted(event, trustedOrigin)) { reject(channel, event); return; }
        listener(event, ...args);
      });
    },
  };
}

// The app's page is served from app://ui (APP_RENDERER_URL in protocol.js). Written out, not
// derived with new URL(): Node gives a non-special scheme the origin "null".
const APP_ORIGIN = 'app://ui';

// The guard bootstrap installs. Only a real Electron process has process.versions.electron;
// the unit tests drive bootstrap with a mock process and hand-made events, and test the
// guard itself in ipc-guard.test.js.
function guardIpc(ipcMain, { proc, writeLog }) {
  if (!(proc && proc.versions && proc.versions.electron)) return ipcMain;
  return createGuardedIpc(ipcMain, { trustedOrigin: APP_ORIGIN, log: (m) => writeLog('warn', 'ipc', m) });
}

module.exports = { createGuardedIpc, senderIsTrusted, guardIpc, APP_ORIGIN };
