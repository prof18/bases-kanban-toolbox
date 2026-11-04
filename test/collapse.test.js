import { test } from 'vitest';
import assert from 'node:assert/strict';
import { COLLAPSED_WIDTH, viewKey, groupKey, columnOffsets, CollapsedStore, ColumnCollapse } from '../src/collapse.js';

const viewFor = (path = 'boards/Agenda.base', name = 'Board') => ({
  queryController: { query: { file: path ? { path } : null } },
  config: { getViewName: () => name },
});
const group = key => ({ key: key === null ? null : { toString: () => key } });

test('view and group keys identify the Base file, view and column', () => {
  assert.equal(viewKey(viewFor()), 'boards/Agenda.base\u0000Board');
  assert.equal(viewKey(viewFor(null)), null);
  assert.equal(groupKey(group('done')), 'done');
  assert.equal(groupKey(group(null)), '');
});

test('collapsed columns shrink to strips and shift the following columns', () => {
  const { columns, end } = columnOffsets([false, true, false], 12, 270, 8);
  assert.deepEqual(columns, [{ start: 12, width: 270 }, { start: 290, width: COLLAPSED_WIDTH }, { start: 290 + COLLAPSED_WIDTH + 8, width: 270 }]);
  assert.equal(end, 290 + COLLAPSED_WIDTH + 8 + 270 + 8);
});

test('store toggles per view, persists, drops empty views and follows renames', () => {
  const saved = [];
  const store = new CollapsedStore({}, data => saved.push(JSON.parse(JSON.stringify(data))));
  const board = viewFor(), other = viewFor('boards/Agenda.base', 'Table');
  assert.equal(store.toggle(board, group('done')), true);
  assert.equal(store.has(board, group('done')), true);
  assert.equal(store.has(other, group('done')), false);
  assert.equal(store.has(board, group('todo')), false);
  assert.equal(store.toggle(board, group('done')), false);
  assert.deepEqual(saved.at(-1), {});
  store.toggle(board, group('todo'));
  store.rename('boards/Agenda.base', 'boards/Life.base');
  assert.equal(store.has(viewFor('boards/Life.base'), group('todo')), true);
  assert.equal(store.has(board, group('todo')), false);
  assert.equal(store.toggle(viewFor(null), group('todo')), false);
});

function element() {
  const classes = new Set(), children = [], listeners = {};
  const el = {
    classes, children, listeners, style: {}, attrs: {}, parentElement: null,
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), contains: name => classes.has(name), remove: name => classes.delete(name) },
    addEventListener(type, callback) { listeners[type] = callback; },
    setAttribute(name, value) { this.attrs[name] = value; },
    setCssStyles(styles) { Object.assign(this.style, styles); },
    appendChild(child) { child.parentElement = el; children.push(child); },
    prepend(child) { child.parentElement = el; children.unshift(child); },
    remove() { if (el.parentElement) el.parentElement.children.splice(el.parentElement.children.indexOf(el), 1); el.parentElement = null; },
    querySelector(selector) { return selector.includes('bkt-collapse') ? children.find(child => child.className?.includes('bkt-collapse')) || null : null; },
    setChildrenInPlace(list) { children.length = 0; children.push(...list); },
    isShown: () => true,
  };
  el.ownerDocument = { createElement: () => element() };
  return el;
}

function board(keys) {
  class Column {
    constructor(view, key) {
      this.view = view; this.group = group(key); this.containerEl = element(); this.headerEl = element(); this.innerEl = element();
      this.rendered = 0; this.recycled = 0;
    }
    render() { this.headerEl.children.length = 0; }
    readViewport() {}
    updateVirtualDisplay() { this.rendered++; }
    recycleItems() { this.recycled++; }
  }
  class View {
    updateVirtualDisplay() {
      // Native pass: uniform widths, only the first column fits the viewport.
      this.columns.forEach((column, index) => {
        column.containerEl.setCssStyles({ insetInlineStart: 12 + index * 278 + 'px', width: '270px' });
        if (index === 0) { if (!column.containerEl.parentElement) this.containerEl.appendChild(column.containerEl); }
        else column.containerEl.remove();
      });
    }
  }
  const view = Object.assign(new View(), viewFor(), { data: {}, containerEl: element(),
    measurements: { pad: { start: 12, end: 12, top: 8, bottom: 8 }, columnWidth: 270, columnGap: 8 } });
  view.columns = keys.map(key => new Column(view, key));
  return { view, Column, View };
}

test('layout keeps native widths without collapsed columns and narrows collapsed ones', () => {
  const store = new CollapsedStore();
  const icons = [];
  const { view, Column, View } = board(['todo', 'in progress', 'done']);
  const original = { view: View.prototype.updateVirtualDisplay, render: Column.prototype.render };
  const collapse = new ColumnCollapse(store, (el, icon) => icons.push(icon));
  collapse.install(view);
  view.updateVirtualDisplay();
  assert.equal(view.columns[2].containerEl.style.width, '270px');
  assert.equal(view.columns[2].containerEl.parentElement, null);
  const [todo, progress, done] = view.columns;
  const button = todo.headerEl.children[0];
  assert.match(button.className, /bkt-collapse/);
  assert.equal(button.attrs['aria-label'], 'Collapse column');

  button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(todo.containerEl.classes.has('bkt-collapsed'), true);
  assert.equal(todo.headerEl.children[0].attrs['aria-label'], 'Expand column');
  assert.equal(todo.containerEl.style.width, COLLAPSED_WIDTH + 'px');
  assert.equal(progress.containerEl.style.insetInlineStart, 12 + COLLAPSED_WIDTH + 8 + 'px');
  assert.equal(done.containerEl.style.insetInlineStart, 12 + COLLAPSED_WIDTH + 8 + 278 + 'px');
  assert.ok([progress, done].every(column => column.containerEl.parentElement === view.containerEl && column.rendered > 0));
  assert.ok(todo.recycled > 0);
  assert.equal(view.containerEl.style.width, 12 + COLLAPSED_WIDTH + 8 + 278 * 2 - 8 + 12 + 'px');

  // Native re-render empties the header; the toggle comes back with the right state.
  todo.render();
  assert.equal(todo.headerEl.children[0].attrs['aria-label'], 'Expand column');
  todo.headerEl.listeners.click({ defaultPrevented: false });
  assert.equal(todo.containerEl.classes.has('bkt-collapsed'), false);
  assert.equal(todo.containerEl.style.width, '270px');

  collapse.destroy();
  assert.equal(View.prototype.updateVirtualDisplay, original.view);
  assert.equal(Column.prototype.render, original.render);
  assert.equal(todo.headerEl.children.length, 0);
});
