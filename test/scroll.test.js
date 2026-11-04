import { test } from 'vitest';
import assert from 'node:assert/strict';
import { cleanColumns, ScrollMemory } from '../src/scroll.js';

const group = key => ({ key: { toString: () => key } });
function element(connected = true) {
  return { isConnected: connected, scrollTop: 0, scrollLeft: 0, listeners: [], style: {},
    addEventListener(type, callback, options) { this.listeners.push({ type, callback, options }); },
    removeEventListener(type, callback) { this.listeners = this.listeners.filter(item => item.callback !== callback); },
    // Capturing listeners on the board see scrolls of its columns.
    scroll(target = this) { this.listeners.forEach(item => item.callback({ target })); } };
}
// Mirrors Obsidian 1.14.5: left is a fraction of the board width, applied from
// pendingScroll on the next pass once the board has any width.
function fixture(keys = ['todo', 'doing', 'done']) {
  class View {
    constructor() {
      this.lastScroll = { left: 0 }; this.pendingScroll = null; this.shown = true; this.data = { properties: ['file.name'] };
      this.scrollEl = element();
      this.containerEl = { isShown: () => this.shown, style: {} };
      this.columns = keys.map(key => ({ group: group(key), contentEl: element() }));
    }
    updateVirtualDisplay() {
      const width = this.data ? this.columns.length * 300 : 20;
      this.containerEl.style.width = width + 'px';
      if (this.pendingScroll) { this.scrollEl.scrollLeft = width * this.pendingScroll.left; this.lastScroll = this.pendingScroll; this.pendingScroll = null; }
      this.lastScroll = { left: this.shown ? this.scrollEl.scrollLeft / width : 0 };
    }
    getEphemeralState() { return { scroll: this.lastScroll }; }
    setEphemeralState(state) { const t = state.scroll; if (t && typeof t === 'object') this.pendingScroll = t; }
  }
  View.prototype.scrollColumn = function(index, top) { const el = this.columns[index].contentEl; el.scrollTop = top; this.scrollEl.scroll(el); };
  const memory = new ScrollMemory(), view = new View();
  memory.install(view);
  return { memory, view, View };
}

test('clean columns keeps only positive finite offsets', () => {
  assert.deepEqual(cleanColumns({ a: 10, b: 0, c: -1, d: 'x', e: NaN }), { a: 10 });
  assert.deepEqual(cleanColumns(null), {});
});

test('history state keeps native left and adds column offsets', () => {
  const { view } = fixture();
  view.updateVirtualDisplay();
  view.scrollEl.scrollLeft = 450;
  view.updateVirtualDisplay();
  view.scrollColumn(1, 900);
  assert.deepEqual(view.getEphemeralState(), { scroll: { left: 0.5, columns: { doing: 900 } } });
  view.updateVirtualDisplay();
  assert.deepEqual(view.lastScroll, { left: 0.5, columns: { doing: 900 } }, 'native pass keeps the columns');
});

test('Back restores both axes after data loads and columns attach', () => {
  const { View } = fixture();
  const next = new View();
  next.data = null;
  next.setEphemeralState({ scroll: { left: 0.5, columns: { doing: 900, gone: 30 } } });
  next.updateVirtualDisplay();
  assert.equal(next.pendingScroll, null, 'native consumed it on the empty board');
  next.data = { properties: [] };
  next.columns[1].contentEl.isConnected = false;
  next.updateVirtualDisplay();
  assert.equal(next.scrollEl.scrollLeft, 450);
  assert.equal(next.columns[1].contentEl.scrollTop, 0, 'detached column waits');
  next.scrollEl.scroll();
  assert.deepEqual(next.lastScroll.columns, { doing: 900 }, 'waiting offset survives, removed groups are dropped');
  next.columns[1].contentEl.isConnected = true;
  next.updateVirtualDisplay();
  assert.equal(next.columns[1].contentEl.scrollTop, 900);
  assert.equal(next.getEphemeralState().scroll.left, 0.5);
});

test('a column reset by a DOM move is restored on the next pass', () => {
  const { view } = fixture();
  view.updateVirtualDisplay();
  view.scrollColumn(2, 640);
  view.columns[2].contentEl.scrollTop = 0;
  view.scrollEl.scroll(view.columns[0].contentEl);
  view.updateVirtualDisplay();
  assert.equal(view.columns[2].contentEl.scrollTop, 640);
  view.scrollColumn(2, 0);
  view.updateVirtualDisplay();
  assert.equal(view.columns[2].contentEl.scrollTop, 0, 'scrolling back to the top is kept');
  assert.deepEqual(view.lastScroll.columns, {});
});

test('saved history state is not mutated by later scrolling', () => {
  const { view } = fixture();
  view.updateVirtualDisplay();
  view.scrollColumn(0, 100);
  const saved = view.getEphemeralState().scroll;
  view.scrollColumn(0, 700);
  assert.deepEqual(saved.columns, { todo: 100 });
  assert.deepEqual(view.lastScroll.columns, { todo: 700 });
});

test('hidden views keep their state and restore it when shown again', () => {
  const { view } = fixture();
  view.updateVirtualDisplay();
  view.scrollEl.scrollLeft = 300;
  view.updateVirtualDisplay();
  view.scrollColumn(0, 400);
  view.shown = false;
  view.scrollEl.scrollLeft = 0;
  view.scrollColumn(0, 0);
  view.columns[0].contentEl.scrollTop = 0;
  view.updateVirtualDisplay();
  assert.deepEqual(view.getEphemeralState().scroll, { left: 1 / 3, columns: { todo: 400 } });
  view.shown = true;
  view.updateVirtualDisplay();
  assert.equal(view.scrollEl.scrollLeft, 300);
  assert.equal(view.columns[0].contentEl.scrollTop, 400);
});

test('malformed column state is ignored', () => {
  const { view } = fixture(['todo']);
  view.setEphemeralState({ scroll: { left: 0, columns: { todo: 'x', other: -5 } } });
  view.updateVirtualDisplay();
  assert.equal(view.columns[0].contentEl.scrollTop, 0);
  assert.deepEqual(view.lastScroll.columns, {});
});

test('destroy restores the prototype and removes listeners', () => {
  const { memory, view, View } = fixture();
  const wrapped = View.prototype.updateVirtualDisplay;
  view.updateVirtualDisplay();
  assert.equal(view.scrollEl.listeners.length, 1);
  assert.equal(view.scrollEl.listeners[0].options.capture, true);
  memory.destroy();
  assert.equal(view.scrollEl.listeners.length, 0);
  assert.notEqual(View.prototype.updateVirtualDisplay, wrapped);
});
