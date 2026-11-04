import { TFile, notices, setApiVersion, resetNotices } from 'obsidian';
import PluginClass from '../src/main.js';

const classList = () => {
  const names = new Set();
  return { names, add: (...items) => items.forEach(name => names.add(name)), remove: (...items) => items.forEach(name => names.delete(name)),
    toggle: (name, force) => { const on = force ?? !names.has(name); if (on) names.add(name); else names.delete(name); return on; }, contains: name => names.has(name) };
};
const style = () => ({ setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } });

// A loaded plugin on a one-column board with cards A, B and C, sorted by Position.
export async function fixture(data = null) {
  setApiVersion('1.14.4'); resetNotices();
  // Classes per fixture, so every fixture gets fresh prototypes for the modules to patch.
  class FakeKanbanView { updateVirtualDisplay() { this.passes = (this.passes || 0) + 1; } }
  class FakeColumn { updateVirtualDisplay() {} render() {} readViewport() {} recycleItems() {} }
  const files = ['A', 'B', 'C'].map((name, i) => {
    const file = new TFile(`items/${name}.md`);
    file.fm = { Status: 'Todo', Position: i + 1, title: name, untouched: true };
    return file;
  });
  const group = { key: 'Todo', entries: files.map(file => ({ file })) };
  const cardEl = { contains: () => false, ownerDocument: { defaultView: { getSelection: () => ({ rangeCount: 0 }) } },
    closest: selector => (selector === '.bases-kanban-card' ? cardEl : null) };
  const view = Object.assign(new FakeKanbanView(), { type: 'kanban', app: null, isReadOnly: false, columns: [], measurements: { cardHeight: 80, cardGap: 16 },
    config: { groupBy: { property: 'Status' }, getSort: () => [{ property: 'Position', direction: 'ASC' }], getLimit: () => 0 },
    queryController: { getSearchQuery: () => '' }, containerEl: { isConnected: true, isShown: () => false, classList: classList(), style: style() },
    unusedItems: [], canMoveCard: () => true, moveCardToColumn: async () => {}, pendingScroll: null, lastScroll: null, scrollEl: { addEventListener() {}, removeEventListener() {} } });
  const column = Object.assign(new FakeColumn(), { containerEl: { classList: classList() }, innerEl: { getBoundingClientRect: () => ({ top: 100 }) },
    contentEl: { getBoundingClientRect: () => ({ top: 100, bottom: 500, left: 20, width: 300 }) }, group, view,
    items: [{ el: cardEl, entry: group.entries[0], props: [] }], headerEl: null });
  const done = Object.assign(new FakeColumn(), { containerEl: { classList: classList() }, group: { key: 'Done', entries: [] }, view, items: [], headerEl: null });
  view.columns.push(column, done);
  const app = { dragManager: { draggable: { type: 'kanban-card', view, sourceGroup: group, entry: group.entries[2] } }, metadataCache: { getFileCache: file => ({ frontmatter: file.fm }) },
    vault: { getAbstractFileByPath: filePath => files.find(file => file.path === filePath), read: async file => JSON.stringify(file.fm), on() { return {}; } },
    fileManager: { processFrontMatter: async (file, callback) => callback(file.fm) }, internalPlugins: { plugins: {} }, workspace: null,
    embedRegistry: { embedByExtension: { md: () => ({ load() {}, loadFile: async () => {}, unload() {} }) } } };
  view.app = app;
  const doc = { listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; }, createElement: () => ({ style: {}, remove() { this.removed = true; } }), body: { appendChild(node) { node.attached = true; } } };
  const workspace = { containerEl: { ownerDocument: doc }, onLayoutReady(callback) { this.ready = callback; },
    handlers: {}, on(name, fn) { (this.handlers[name] ||= []).push(fn); return {}; }, iterateAllLeaves() {} };
  app.workspace = workspace;
  const plugin = new PluginClass(app);
  plugin.storedData = data;
  await plugin.onload();
  plugin.active = true;
  const target = { ownerDocument: doc, closest: selector => selector === '.bases-kanban-column' ? column.containerEl : null };
  const event = (y, overrides = {}) => ({ target, clientY: y, defaultPrevented: false, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...overrides });
  return { plugin, app, doc, files, group, column, done, cardEl, view, target, event, notices, FakeKanbanView, FakeColumn };
}
