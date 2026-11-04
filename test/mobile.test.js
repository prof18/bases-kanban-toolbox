import { test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TFile, notices, setApiVersion, resetNotices } from 'obsidian';
import PluginClass from '../src/main.js';

// Vite rewrites new URL(literal, import.meta.url) into a dev-server URL; a variable base avoids that.
const here = import.meta.url;
const mainSource = fs.readFileSync(new URL('../src/main.js', here), 'utf8');

beforeEach(() => { setApiVersion('1.14.4'); resetNotices(); });

function fixture() {
  setApiVersion('1.14.4'); resetNotices();
  const files = ['A', 'B', 'C'].map((name, i) => {
    const file = new TFile(`items/${name}.md`);
    file.fm = { Status: 'Todo', Position: i + 1, title: name, untouched: true };
    return file;
  });
  const group = { entries: files.map(file => ({ file })) };
  const column = { containerEl: {}, innerEl: { getBoundingClientRect: () => ({ top: 100 }) }, contentEl: { getBoundingClientRect: () => ({ top: 100, bottom: 500, left: 20, width: 300 }) }, group };
  const view = { type: 'kanban', app: null, isReadOnly: false, columns: [column], measurements: { cardHeight: 80, cardGap: 16 },
    config: { groupBy: { property: 'Status' }, getSort: () => [{ property: 'Position', direction: 'ASC' }], getLimit: () => 0 },
    queryController: { getSearchQuery: () => '' }, containerEl: { isConnected: true } };
  const app = { dragManager: { draggable: { type: 'kanban-card', view, sourceGroup: group, entry: group.entries[2] } }, metadataCache: { getFileCache: file => ({ frontmatter: file.fm }) },
    vault: { getAbstractFileByPath: filePath => files.find(file => file.path === filePath), read: async file => JSON.stringify(file.fm), on() { return {}; } },
    fileManager: { processFrontMatter: async (file, callback) => callback(file.fm) }, internalPlugins: { plugins: {} }, workspace: null };
  view.app = app;
  const doc = { listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; }, createElement: () => ({ style: {}, remove() { this.removed = true; } }), body: { appendChild(node) { node.attached = true; } } };
  const workspace = { containerEl: { ownerDocument: doc }, onLayoutReady(callback) { this.ready = callback; }, on() { return {}; }, iterateAllLeaves() {} };
  app.workspace = workspace;
  const plugin = new PluginClass(app);
  plugin.onload();
  plugin.active = true;
  const target = { ownerDocument: doc, closest: selector => selector === '.bases-kanban-column' ? column.containerEl : null };
  const event = (y, overrides = {}) => ({ target, clientY: y, defaultPrevented: false, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...overrides });
  return { plugin, app, doc, files, group, column, view, target, event, notices };
}

test('plugin entry has no Node or Electron runtime import and mobile manifest is enabled', () => {
  assert.doesNotMatch(mainSource, /require\(['"](?:node:)?(?:fs|path|electron|child_process|os|process)(?:['"]|\/)/);
  assert.doesNotMatch(mainSource, /from ['"](?:node:)?(?:fs|path|electron|child_process|os|process)(?:['"]|\/)/);
  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', here), 'utf8'));
  assert.equal(manifest.isDesktopOnly, false);
  assert.equal(manifest.id, 'bases-kanban-toolbox');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.minAppVersion, '1.14.0');
});

test('initializes on Obsidian 1.14.4 mobile-style runtime and registers native drag listeners', () => {
  const f = fixture();
  assert.equal(f.plugin.active, true);
  f.plugin.registerDocuments();
  assert.equal(typeof f.doc.listeners.dragover, 'function');
  assert.equal(typeof f.doc.listeners.drop, 'function');
  assert.equal(f.notices.length, 0);
});

test('newer Obsidian releases initialize; older ones are refused with a notice', () => {
  for (const version of ['1.14.0', '1.14.5', '1.15.0']) {
    const app = fixture().app;
    setApiVersion(version); resetNotices();
    const plugin = new PluginClass(app);
    plugin.onload();
    assert.ok(plugin.compact, version);
    assert.equal(notices.length, 0, version);
  }
  const app = fixture().app;
  setApiVersion('1.13.9'); resetNotices();
  const plugin = new PluginClass(app);
  plugin.onload();
  assert.equal(plugin.compact, undefined);
  assert.match(notices[0], /1\.14\.0 or newer/);
});

test('native dragover and drop use compact row geometry and save same-column order', async () => {
  const f = fixture();
  const compact = f.plugin.compact;
  const layout = { rows: [{ top: 0, height: 40 }, { top: 48, height: 120 }, { top: 176, height: 40 }] };
  f.plugin.compact = { forColumn: () => layout };
  const hover = f.event(48 + 120);
  f.plugin.handleDrag(hover, false);
  assert.equal(hover.prevented, true);
  assert.equal(hover.dataTransfer, undefined);
  assert.equal(f.plugin.marker.className, 'bkt-order-marker');
  const drop = f.event(48 + 120);
  f.plugin.handleDrag(drop, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(drop.prevented, true);
  assert.equal(drop.stopped, true);
  assert.deepEqual(f.files.map(file => file.fm.Position), [1, 3, 2]);
  assert.ok(f.files.every(file => file.fm.untouched));
  f.plugin.compact = compact;
});

test('cancelled, unsupported, and cross-column drag contexts do not write', async () => {
  const f = fixture();
  let writes = 0;
  f.app.fileManager.processFrontMatter = async () => { writes++; };
  const cancelled = f.event(150, { defaultPrevented: true });
  f.plugin.handleDrag(cancelled, true);
  const unsupported = f.event(150);
  f.view.config.getLimit = () => 4;
  f.plugin.handleDrag(unsupported, true);
  f.view.config.getLimit = () => 0;
  f.app.dragManager.draggable.sourceGroup = { entries: f.group.entries };
  const crossColumn = f.event(150);
  f.plugin.handleDrag(crossColumn, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 0);
  assert.equal(cancelled.prevented, false);
  assert.equal(unsupported.prevented, false);
  assert.equal(crossColumn.prevented, false);
});

test('touch cancellation, touch end, and unload clear the drag marker', () => {
  const f = fixture();
  f.plugin.registerDocuments();
  for (const type of ['touchcancel', 'touchend']) {
    const marker = { remove() { this.removed = true; } };
    f.plugin.marker = marker;
    f.doc.listeners[type]();
    assert.equal(marker.removed, true);
    assert.equal(f.plugin.marker, null);
  }
  const marker = { remove() { this.removed = true; } };
  f.plugin.marker = marker;
  f.plugin.onunload();
  assert.equal(marker.removed, true);
  assert.equal(f.plugin.active, false);
});

test('columns fill the board while a card is dragged and fit again after it ends', async () => {
  const f = fixture();
  const classes = new Set();
  f.view.containerEl.classList = { add: name => classes.add(name), remove: name => classes.delete(name) };
  f.plugin.registerDocuments();
  for (const type of ['dragend', 'touchend', 'touchcancel']) {
    f.doc.listeners.dragover(f.event(140));
    assert.equal(classes.has('bkt-dragging'), true, type);
    f.doc.listeners[type]();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(classes.has('bkt-dragging'), false, type);
  }
  f.app.dragManager.draggable = { type: 'file' };
  f.doc.listeners.dragover(f.event(140));
  assert.equal(classes.has('bkt-dragging'), false, 'other drags leave the layout alone');
});
