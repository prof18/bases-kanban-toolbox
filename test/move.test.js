import { test } from 'vitest';
import assert from 'node:assert/strict';
import { cardContext, columnLabel, moveTargets, addMoveItems } from '../src/move.js';

const group = key => ({ key: { toString: () => key } });
function board({ movable = true } = {}) {
  const file = { path: 'items/A.md' };
  const cardEl = { id: 'card' };
  const moves = [];
  const view = { canMoveCard: () => movable, moveCardToColumn: async (moved, key) => { moves.push([moved, String(key)]); }, columns: [] };
  const column = (key, heading, items = []) => ({ group: group(key), items, headerEl: { querySelector: () => (heading ? { textContent: heading } : null) } });
  view.columns = [column('todo', 'todo', [{ el: cardEl, entry: { file } }]), column('doing', 'in progress'), column('', null), { group: null, items: [] }];
  const target = { closest: selector => (selector === '.bases-kanban-card' ? cardEl : null) };
  return { view, file, target, moves };
}
function fakeMenu(withSubmenus = true) {
  const items = [];
  const makeItem = () => {
    const item = { title: null, onClickFn: null, sub: null };
    item.setTitle = title => { item.title = title; return item; };
    item.setIcon = () => item; item.setSection = () => item;
    item.onClick = fn => { item.onClickFn = fn; return item; };
    if (withSubmenus) item.setSubmenu = () => (item.sub = fakeMenu());
    return item;
  };
  return { items, addItem(callback) { const item = makeItem(); callback(item); items.push(item); return this; } };
}

test('finds the card, its column and the view from a context menu target', () => {
  const { view, file, target } = board();
  const context = cardContext(new Set([view]), target);
  assert.equal(context.view, view);
  assert.equal(context.entry.file, file);
  assert.equal(String(context.column.group.key), 'todo');
  assert.equal(cardContext(new Set([view]), { closest: () => null }), null);
  assert.equal(cardContext(new Set([view]), { closest: () => ({}) }), null, 'cards of other views are ignored');
});

test('targets are the other columns, labelled like their headers', () => {
  const { view, target } = board();
  const context = cardContext([view], target);
  assert.deepEqual(moveTargets(context).map(item => item.label), ['in progress', 'No value']);
  assert.equal(columnLabel(view.columns[1]), 'in progress');
  assert.deepEqual(moveTargets({ ...context, view: { ...view, canMoveCard: () => false } }), [], 'read-only boards get no item');
});

test('Move to submenu moves the card through native moveCardToColumn', async () => {
  const { view, file, target, moves } = board();
  const menu = fakeMenu();
  assert.equal(addMoveItems(menu, cardContext([view], target), () => {}), true);
  assert.equal(menu.items.length, 1);
  assert.equal(menu.items[0].title, 'Move to column');
  const sub = menu.items[0].sub;
  assert.deepEqual(sub.items.map(item => item.title), ['in progress', 'No value']);
  sub.items[0].onClickFn();
  await Promise.resolve();
  assert.deepEqual(moves, [[file, 'doing']]);
});

test('menus without submenus get one entry per column, and failures are reported', async () => {
  const { view, target } = board();
  const errors = [];
  view.moveCardToColumn = async () => { throw new Error('locked'); };
  const menu = fakeMenu(false);
  addMoveItems(menu, cardContext([view], target), error => errors.push(error.message));
  assert.deepEqual(menu.items.map(item => item.title), ['Move to in progress', 'Move to No value']);
  menu.items[1].onClickFn();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(errors, ['locked']);
});

test('no item when the board cannot move the card', () => {
  const { view, target } = board({ movable: false });
  const menu = fakeMenu();
  assert.equal(addMoveItems(menu, cardContext([view], target), () => {}), false);
  assert.equal(menu.items.length, 0);
});
