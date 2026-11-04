import { test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { setApiVersion, resetNotices } from 'obsidian';
import { fixture } from './fixture.js';

beforeEach(() => { setApiVersion('1.14.4'); resetNotices(); });

const set = (plugin, key, value) => plugin.updateSettings(s => { s.features[key] = value; });

test('turning collapsible columns off drops only the collapse module', async () => {
  const f = await fixture();
  f.plugin.install(f.view);
  await set(f.plugin, 'collapsibleColumns', false);
  assert.equal(f.plugin.collapse, null);
  assert.notEqual(f.plugin.compact, null);
  assert.notEqual(f.plugin.scroll, null);
});

test('turning a module back on rebuilds it and re-renders every connected view', async () => {
  const f = await fixture();
  f.plugin.install(f.view);
  await set(f.plugin, 'collapsibleColumns', false);
  const passes = f.view.passes || 0;
  await set(f.plugin, 'collapsibleColumns', true);
  assert.notEqual(f.plugin.collapse, null);
  // The teardown repaints once to restore native layout; the rebuilt modules then lay the view out again.
  assert.ok(f.view.passes > passes);
  assert.ok(f.plugin.collapse.views.has(f.view), 'the rebuilt collapse module laid the view out');
});

test('wrappers install, unstack when every module is off, and come back', async () => {
  const f = await fixture();
  const native = f.FakeKanbanView.prototype.updateVirtualDisplay;
  f.plugin.install(f.view);
  assert.notEqual(Object.getPrototypeOf(f.view).updateVirtualDisplay, native);
  await f.plugin.updateSettings(s => { s.features.compactCards = false; s.features.fitColumns = false; s.features.collapsibleColumns = false; s.features.scrollRestore = false; });
  assert.equal(Object.getPrototypeOf(f.view).updateVirtualDisplay, native);
  await f.plugin.updateSettings(s => { s.features.compactCards = true; s.features.fitColumns = true; s.features.collapsibleColumns = true; s.features.scrollRestore = true; });
  assert.notEqual(Object.getPrototypeOf(f.view).updateVirtualDisplay, native);
  f.plugin.onunload();
  assert.equal(Object.getPrototypeOf(f.view).updateVirtualDisplay, native);
});

test('compact layout exists while either compact cards or fitted columns is on', async () => {
  const f = await fixture();
  await set(f.plugin, 'compactCards', false);
  assert.notEqual(f.plugin.compact, null);
  await set(f.plugin, 'fitColumns', false);
  assert.equal(f.plugin.compact, null);
});

test('restore scroll position can be turned off and on', async () => {
  const f = await fixture();
  await set(f.plugin, 'scrollRestore', false);
  assert.equal(f.plugin.scroll, null);
  await set(f.plugin, 'scrollRestore', true);
  assert.notEqual(f.plugin.scroll, null);
});

test('disconnected views drop out of the registry', async () => {
  const f = await fixture();
  f.plugin.install(f.view);
  assert.deepEqual(f.plugin.liveViews(), [f.view]);
  f.view.containerEl.isConnected = false;
  assert.deepEqual(f.plugin.liveViews(), []);
  assert.equal(f.plugin.views.has(f.view), false);
});

// Events reach the plugin through the document listeners, so install the view first:
// the fixture's iterateAllLeaves yields nothing, and liveViews() would be empty.
async function wired() {
  const f = await fixture();
  f.plugin.install(f.view);
  f.plugin.registerDocuments();
  const click = () => ({ button: 0, target: f.cardEl, defaultPrevented: false, preventDefault() { this.prevented = true; } });
  const menu = () => {
    const m = { items: [], addItem(cb) { const item = { setTitle() { return item; }, setIcon() { return item; }, setSection() { return item; }, onClick() { return item; } }; m.items.push(item); cb(item); } };
    return m;
  };
  // file-menu must run synchronously after contextmenu, before its window.setTimeout(…, 0) clears cardMenu.
  const openMenu = () => {
    assert.equal(typeof f.doc.listeners.contextmenu, 'function');
    const m = menu();
    f.doc.listeners.contextmenu({ target: f.cardEl });
    for (const handler of f.app.workspace.handlers['file-menu']) handler(m, f.group.entries[0].file);
    return m;
  };
  return { ...f, click, openMenu };
}

test('card popup opens on a plain click only while the feature is on', async () => {
  const f = await wired();
  assert.equal(typeof f.doc.listeners.click, 'function');
  const on = f.click();
  f.doc.listeners.click(on);
  assert.equal(on.prevented, true);
  assert.notEqual(f.plugin.cardModal, null);
  await f.plugin.updateSettings(s => { s.features.cardPopup = false; });
  assert.equal(f.plugin.cardModal, null, 'turning the popup off closes an open one');
  const off = f.click();
  f.doc.listeners.click(off);
  assert.equal(off.prevented, undefined);
  assert.equal(f.plugin.cardModal, null);
});

test('Move to column adds its item only while the feature is on', async () => {
  const f = await wired();
  assert.equal(f.openMenu().items.length, 1);
  await f.plugin.updateSettings(s => { s.features.moveToColumn = false; });
  assert.equal(f.openMenu().items.length, 0);
});

test('popup and Move to column work with compact cards and fitted columns off', async () => {
  const f = await wired();
  await f.plugin.updateSettings(s => { s.features.compactCards = false; s.features.fitColumns = false; });
  assert.equal(f.plugin.compact, null);
  const click = f.click();
  f.doc.listeners.click(click);
  assert.equal(click.prevented, true);
  assert.notEqual(f.plugin.cardModal, null);
  assert.equal(f.openMenu().items.length, 1);
});

test('manual order off leaves drops native and hides the undo command', async () => {
  const f = await fixture();
  const undo = f.plugin.commands.find(cmd => cmd.id === 'undo-reorder');
  assert.equal(undo.checkCallback(true), true);
  await f.plugin.updateSettings(s => { s.features.manualOrder = false; });
  const drop = f.event(168);
  f.plugin.handleDrag(drop, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.files.map(file => file.fm.Position), [1, 2, 3]);
  assert.equal(drop.prevented, false);
  assert.equal(undo.checkCallback(true), false);
});

test('settings that are read per event do not rebuild the modules', async () => {
  const f = await fixture();
  const { collapse, scroll } = f.plugin;
  await f.plugin.updateSettings(s => { s.features.cardPopup = false; });
  await f.plugin.updateSettings(s => { s.orderProperty = 'Rank'; });
  await f.plugin.updateSettings(s => { s.autoSort = false; });
  assert.equal(f.plugin.collapse, collapse);
  assert.equal(f.plugin.scroll, scroll);
});
