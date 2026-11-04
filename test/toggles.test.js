import { test, beforeEach, vi } from 'vitest';
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

// dropSlot decides the slot: clientY 100 is the top (slot 0), 300 is the third card's own slot (slot 2).
const useDropSlot = plugin => { if (plugin.compact) vi.spyOn(plugin.compact, 'forColumn').mockReturnValue(null); };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a configured order property is written instead of Position', async () => {
  const f = await fixture({ orderProperty: 'Rank' });
  f.files.forEach((file, i) => { file.fm.Rank = i + 1; });
  f.view.config.getSort = () => [{ property: 'note.Rank', direction: 'ASC' }];
  useDropSlot(f.plugin);
  const drop = f.event(100);
  f.plugin.handleDrag(drop, true);
  await settle();
  assert.equal(drop.prevented, true);
  assert.deepEqual(f.files.map(file => file.fm.Rank), [2, 3, 1]);
  assert.deepEqual(f.files.map(file => file.fm.Position), [1, 2, 3]);
});

// An unsorted board whose config can sort, recording each setSortProperty call.
async function unsorted(data = null, positions = [1, 2, 3]) {
  const f = await fixture(data);
  f.files.forEach((file, i) => { if (positions[i] === undefined) delete file.fm.Position; else file.fm.Position = positions[i]; });
  f.view.config.getSort = () => [{ property: 'note.Status', direction: 'ASC' }];
  f.view.config.setSortProperty = function(p, d) { this.sortCalls = [...(this.sortCalls || []), [p, d]]; };
  useDropSlot(f.plugin);
  return f;
}
const positions = f => f.files.map(file => file.fm.Position);

test('the first reorder on an unsorted board writes ranks, then sorts the board by them', async () => {
  const f = await unsorted();
  const drop = f.event(100);
  f.plugin.handleDrag(drop, true);
  await settle();
  assert.equal(drop.prevented, true);
  assert.deepEqual(positions(f), [2, 3, 1]);
  assert.deepEqual(f.view.config.sortCalls, [['note.Position', 'ASC']]);
  assert.equal(f.notices.length, 1);
  assert.match(f.notices[0], /now sorted by Position/);
});

test('when ranks already match the new order, the board is only sorted', async () => {
  const f = await unsorted(null, [2, 3, 1]);
  let writes = 0;
  const process = f.app.fileManager.processFrontMatter;
  f.app.fileManager.processFrontMatter = async (...args) => { writes++; return process(...args); };
  const drop = f.event(100);
  f.plugin.handleDrag(drop, true);
  await settle();
  assert.equal(writes, 0);
  assert.equal(drop.prevented, true);
  assert.deepEqual(positions(f), [2, 3, 1]);
  assert.deepEqual(f.view.config.sortCalls, [['note.Position', 'ASC']]);
});

test('with automatic sorting off, unsorted boards stay native', async () => {
  const f = await unsorted({ autoSort: false });
  const drop = f.event(100);
  f.plugin.handleDrag(drop, true);
  await settle();
  assert.equal(drop.prevented, false);
  assert.deepEqual(positions(f), [1, 2, 3]);
  assert.equal(f.view.config.sortCalls, undefined);
});

test('a board already sorted by the order property is not sorted again', async () => {
  const f = await fixture();
  f.view.config.setSortProperty = function(p, d) { this.sortCalls = [...(this.sortCalls || []), [p, d]]; };
  useDropSlot(f.plugin);
  f.plugin.handleDrag(f.event(100), true);
  await settle();
  assert.deepEqual(positions(f), [2, 3, 1]);
  assert.equal(f.view.config.sortCalls, undefined);
});

test('dropping a card back into its own slot on an unsorted board does nothing', async () => {
  for (const start of [[undefined, undefined, undefined], [10, 20, 30]]) {
    const f = await unsorted(null, start);
    const drop = f.event(300);
    f.plugin.handleDrag(drop, true);
    await settle();
    assert.equal(drop.prevented, false, JSON.stringify(start));
    assert.deepEqual(positions(f), start.every(value => value === undefined) ? [undefined, undefined, undefined] : start);
    assert.equal(f.view.config.sortCalls, undefined);
  }
});

test('settings changed while the notes are saving stop the sort', async () => {
  for (const change of [s => { s.autoSort = false; }, s => { s.features.manualOrder = false; }]) {
    const f = await unsorted();
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const process = f.app.fileManager.processFrontMatter;
    f.app.fileManager.processFrontMatter = async (...args) => { await held; return process(...args); };
    f.plugin.handleDrag(f.event(100), true);
    await f.plugin.updateSettings(change);
    release();
    for (let i = 0; i < 5; i++) await settle();
    assert.deepEqual(positions(f), [2, 3, 1]);
    assert.equal(f.view.config.sortCalls, undefined);
  }
});

test('a failed sort keeps the written ranks and says so', async () => {
  const f = await unsorted();
  f.view.config.setSortProperty = () => { throw new Error('read-only'); };
  f.plugin.handleDrag(f.event(100), true);
  await settle();
  assert.deepEqual(positions(f), [2, 3, 1]);
  assert.match(f.notices.at(-1), /could not be sorted/);
});
