import { describe, test, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { findDebugSwitch, isReleaseBuild, refuseDebugSwitch } = require('../../src/main/launch-guard.js');

// QA-L1 / N6: the packaged build accepted --remote-debugging-port (full DevTools Protocol).
describe('launch guard', () => {
  test.each([
    ['--remote-debugging-port=9222', 'remote-debugging-port'],
    ['--remote-debugging-pipe', 'remote-debugging-pipe'],
    ['-remote-debugging-port=0', 'remote-debugging-port'],
    ['/REMOTE-DEBUGGING-PORT=1', 'remote-debugging-port'],
    ['--inspect', 'inspect'],
    ['--inspect-brk=9229', 'inspect-brk'],
  ])('%s is found', (arg, name) => {
    expect(findDebugSwitch(['app.exe', 'note.md', arg])).toBe(name);
  });

  test('ordinary arguments and note names are not switches', () => {
    expect(findDebugSwitch(['app.exe', 'C:\\notes\\--inspect.md', 'remote-debugging-port.md', '--lang=ar'])).toBeNull();
    expect(findDebugSwitch(undefined)).toBeNull();
  });

  test('a release build is packaged or runs from an .asar, unless it is the smoke-test build', () => {
    expect(isReleaseBuild({ isPackaged: true, dirname: '/x' })).toBe(true);
    expect(isReleaseBuild({ isPackaged: false, dirname: 'C:\\App\\resources\\app.asar\\src\\main' })).toBe(true);
    expect(isReleaseBuild({ isPackaged: false, dirname: '/repo/src/main' })).toBe(false);
    expect(isReleaseBuild({ isPackaged: true, dirname: '/x', testBuild: true })).toBe(false);
  });

  test('a release build exits on a debug switch and says why; a dev run does not', () => {
    const app = { isPackaged: true, exit: vi.fn() };
    const warn = vi.fn();
    expect(refuseDebugSwitch({ app, argv: ['bp', '--remote-debugging-port=9333'], dirname: '/x', warn })).toBe(true);
    expect(app.exit).toHaveBeenCalledWith(1);
    expect(warn.mock.calls[0][0]).toContain('--remote-debugging-port');

    const dev = { isPackaged: false, exit: vi.fn() };
    expect(refuseDebugSwitch({ app: dev, argv: ['electron', '--inspect'], dirname: '/repo/src/main' })).toBe(false);
    expect(dev.exit).not.toHaveBeenCalled();
    expect(refuseDebugSwitch({ app, argv: ['bp', 'a.md'], dirname: '/x' })).toBe(false);
  });
});
