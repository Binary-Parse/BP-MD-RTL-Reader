/**
 * launch-guard.js — QA-L1 / N6: a packaged build refuses to run with a debugging switch.
 *
 * `--remote-debugging-port` (and `-pipe`) opens the Chrome DevTools Protocol, which can read
 * and drive every page of the app. No Electron fuse turns it off (electron/fuses#2 was closed
 * without one; the nodeCliInspect fuse only covers --inspect), so the app checks its own
 * command line and exits before it opens a window or reads a file.
 *
 * Limits, stated plainly: Chromium reads its switches before this code runs, so the port can
 * be open for the moment between start and exit. Someone who can start the app with their
 * own arguments can already read the user's files; this removes the debugger, not that.
 *
 * The packaged smoke test (tests/packaged/linux-smoke.js) needs the switch: it runs a build
 * made with `--config.extraMetadata.bpmdTestBuild=true`, which the release build never has.
 */

// Chromium accepts `--name`, `-name` and, on Windows, `/name`, with or without `=value`.
const DEBUG_SWITCH = /^(?:--?|\/)(remote-debugging-(?:port|pipe|address)|inspect(?:-brk|-port|-publish-uid)?)(?:=|$)/i;

function findDebugSwitch(argv) {
  for (const arg of argv || []) {
    const m = typeof arg === 'string' && DEBUG_SWITCH.exec(arg);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

// `app.isPackaged` is false for a renamed executable, so a path inside an .asar also counts.
function isReleaseBuild({ isPackaged, dirname, testBuild }) {
  return !testBuild && (isPackaged || /\.asar(?:[\\/]|$)/i.test(String(dirname || '')));
}

// True when the app was told to exit.
function refuseDebugSwitch({ app, argv, dirname, testBuild, warn = () => {} }) {
  if (!isReleaseBuild({ isPackaged: !!app.isPackaged, dirname, testBuild })) return false;
  const found = findDebugSwitch(argv);
  if (!found) return false;
  warn(`BP MD RTL Reader does not start with --${found}.`);
  app.exit(1);
  return true;
}

module.exports = { findDebugSwitch, isReleaseBuild, refuseDebugSwitch };
