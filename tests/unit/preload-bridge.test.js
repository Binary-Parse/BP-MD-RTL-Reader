/**
 * preload-bridge.test.js — every method the bridge exposes, driven end to end against
 * mocked contextBridge/ipcRenderer/webFrame. The preload is the security boundary the
 * renderer sees; these tests pin WHICH channel each call crosses with WHICH payload,
 * including the SEC-02 typed-array right-sizing that happens before anything ships.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { setupBridge } from '../../src/preload/index.js';

function buildBridge() {
  const contextBridge = { exposeInMainWorld: vi.fn() };
  const ipcRenderer = { invoke: vi.fn(), on: vi.fn(), send: vi.fn() };
  const webFrame = { setZoomFactor: vi.fn() };
  setupBridge({ contextBridge, ipcRenderer, webFrame });
  const api = contextBridge.exposeInMainWorld.mock.calls[0][1];
  return { api, ipcRenderer, webFrame };
}

describe('preload bridge surface', () => {
  let api;
  let ipcRenderer;
  let webFrame;
  beforeEach(() => {
    ({ api, ipcRenderer, webFrame } = buildBridge());
  });

  test('send-only controls cross with the exact payload shape', () => {
    api.closeWindow();
    api.abortWindowClose();
    api.extendWindowClose();
    api.minimizeWindow();
    api.maximizeWindow();
    api.setFullscreen(true);
    api.reportDirtyState(3);
    api.editCommand('copy');
    api.contextAction({ nonce: 'n1', index: 2 });
    api.contextMenuClosed('n1');
    api.logError({ message: 'boom', stack: '' });
    expect(ipcRenderer.send.mock.calls).toEqual([
      ['window-close-confirmed'],
      ['window-close-aborted'],
      ['window-close-extend'],
      ['window-minimize'],
      ['window-maximize'],
      ['window-set-fullscreen', true],
      ['doc:dirty-state', 3],
      ['edit:command', 'copy'],
      ['context-menu:action', { nonce: 'n1', index: 2 }],
      ['context-menu:closed', { nonce: 'n1' }],
      ['log:error', { message: 'boom', stack: '' }],
    ]);
  });

  test('every invoke channel forwards its exact payload', async () => {
    await api.recoverySnapshot([{ name: 'a.md', content: 'x' }]);
    await api.recoveryPop();
    await api.recoveryClear();
    await api.revealFile('cap-1');
    await api.copyFilePath('cap-1');
    await api.openFolder();
    await api.readVault('cap-v');
    await api.reopenVault('cap-v');
    await api.reopenDocument('cap-d');
    await api.closeVault('cap-v');
    await api.openFile();
    await api.readFile('cap-d');
    await api.writeFile({ documentId: 'cap-d' });
    await api.saveFileAs({ suggestedName: 'a.md' });
    await api.decodeBytes(new Uint8Array([1]));
    await api.getSettings();
    await api.setSettings({ theme: 'ink' });
    await api.annotationsGet('doc:cap-1');
    await api.annotationsPut({ docKey: 'doc:cap-1', highlights: [] });
    await api.statsGet();
    await api.statsAddMinutes(1);
    await api.exportPDF({ html: '<p>x</p>' });
    await api.exportEpub({ bytes: new Uint8Array([2]) });
    await api.checkForUpdate();
    await api.autoUpdateCheck();
    await api.openReleasePage();
    await api.getAppVersion();
    expect(ipcRenderer.invoke.mock.calls.map((c) => c[0])).toEqual([
      'recovery:snapshot', 'recovery:pop', 'recovery:clear',
      'fs:reveal', 'fs:copy-path', 'dialog:openFolder', 'fs:readVault',
      'fs:reopenVault', 'fs:reopenDocument', 'fs:closeVault', 'dialog:openFile',
      'fs:readFile', 'fs:writeFile', 'dialog:saveFile', 'text:decode',
      'settings:get', 'settings:set', 'annotations:get', 'annotations:put',
      'stats:get', 'stats:addMinutes', 'export:pdf', 'export:epub',
      'update:check', 'update:auto-check', 'update:release-page', 'app:version',
    ]);
    expect(ipcRenderer.invoke.mock.calls[0][1]).toEqual([{ name: 'a.md', content: 'x' }]);
    expect(ipcRenderer.invoke.mock.calls[14][1]).toEqual(new Uint8Array([1]));
  });

  test('non-exact typed-array views are right-sized before crossing (SEC-02)', () => {
    const backing = new ArrayBuffer(512);
    const view = new Uint8Array(backing, 256, 2);
    api.decodeBytes(view);
    const sent = ipcRenderer.invoke.mock.calls[0][1];
    expect(sent.byteLength).toBe(2);
    expect(sent.buffer.byteLength).toBe(2);
    api.exportEpub({ bytes: view });
    expect(ipcRenderer.invoke.mock.calls[1][1].bytes.buffer.byteLength).toBe(2);
    api.decodeBytes(new Uint8Array([9]));
    expect(ipcRenderer.invoke.mock.calls[2][1]).toEqual(new Uint8Array([9]));
    api.exportEpub(null);
    expect(ipcRenderer.invoke.mock.calls[3][1]).toBeNull();
  });

  test('setAppZoom clamps 0.6–2.0 and reports the applied factor', () => {
    expect(api.setAppZoom(0.1)).toBe(0.6);
    expect(api.setAppZoom(9)).toBe(2);
    expect(api.setAppZoom(1.25)).toBe(1.25);
    expect(api.setAppZoom(NaN)).toBeNull();
    expect(api.setAppZoom('x')).toBeNull();
    expect(webFrame.setZoomFactor).toHaveBeenNthCalledWith(1, 0.6);
    expect(webFrame.setZoomFactor).toHaveBeenNthCalledWith(3, 1.25);
    expect(webFrame.setZoomFactor).toHaveBeenCalledTimes(3);
  });

  test('main→renderer subscriptions register once and unwrap events', () => {
    const handlers = {};
    ipcRenderer.on.mockImplementation((channel, fn) => { handlers[channel] = fn; });
    const seen = {};
    api.onFullscreenChanged((v) => { seen.full = v; });
    api.onContextMenu((p) => { seen.menu = p; });
    api.onAppCommand((c) => { seen.cmd = c; });
    api.onOpenFile((d) => { seen.file = d; });
    api.onVaultChanged((d) => { seen.vault = d; });
    api.onCloseRequested(() => { seen.close = true; });
    api.onUpdateAvailable((d) => { seen.update = d; });
    handlers['window-fullscreen-changed']({}, true);
    handlers['context-menu:show']({}, { items: [] });
    handlers['app:command']({}, 'selectAll');
    handlers['open-external-file']({}, { name: 'a.md' });
    handlers['vault:changed']({}, { entries: [] });
    handlers['app:request-close']();
    handlers['update:available']({}, { latest: '1.4.0' });
    expect(seen).toEqual({
      full: true,
      menu: { items: [] },
      cmd: 'selectAll',
      file: { name: 'a.md' },
      vault: { entries: [] },
      close: true,
      update: { latest: '1.4.0' },
    });
  });
});
