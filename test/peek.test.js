import { test } from 'vitest';
import assert from 'node:assert/strict';
import { peekTarget, createCardModal } from '../src/peek.js';

function board() {
  const file = { path: 'items/A.md', extension: 'md' };
  const cardEl = { contains: () => false, ownerDocument: { defaultView: { getSelection: () => ({ rangeCount: 0 }) } } };
  const view = { columns: [{ group: { key: 'todo' }, items: [{ el: cardEl, entry: { file } }] }] };
  const app = { embedRegistry: { embedByExtension: { md: () => ({}) } } };
  const target = (inside = null) => ({ closest: selector => (selector === '.bases-kanban-card' ? cardEl : selector.startsWith('a,') ? inside : null) });
  const click = (overrides = {}) => ({ button: 0, defaultPrevented: false, target: target(), ...overrides });
  return { file, cardEl, view, app, target, click };
}

test('a plain click on a card opens the popup', () => {
  const { view, app, click, file } = board();
  assert.equal(peekTarget(click(), [view], app).entry.file, file);
});

test('links, modifier clicks, other buttons and handled clicks keep native behaviour', () => {
  const { view, app, click, target } = board();
  for (const overrides of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }, { target: target({}) }]) {
    assert.equal(peekTarget(click(overrides), [view], app), null, JSON.stringify(Object.keys(overrides)));
  }
  assert.equal(peekTarget(click({ target: { closest: () => null } }), [view], app), null, 'not a card');
});

test('no popup without the note embed, for non-markdown cards, or after selecting card text', () => {
  const { view, app, click, file, cardEl } = board();
  assert.equal(peekTarget(click(), [view], {}), null);
  file.extension = 'canvas';
  assert.equal(peekTarget(click(), [view], app), null);
  file.extension = 'md';
  cardEl.contains = () => true;
  cardEl.ownerDocument.defaultView.getSelection = () => ({ rangeCount: 1, getRangeAt: () => ({ collapsed: false, startContainer: {}, endContainer: {} }) });
  assert.equal(peekTarget(click(), [view], app), null);
});

test('the popup loads an editable embed, saves pending edits on close and can open the note', async () => {
  const element = () => {
    const el = { classes: [], children: [], listeners: {}, text: null,
      addClass(name) { this.classes.push(name); }, createDiv(cls) { const child = element(); child.cls = cls; this.children.push(child); return child; },
      createEl(tag, options) { const child = element(); child.cls = options.cls; this.children.push(child); return child; },
      createSpan(options) { const child = element(); child.text = options?.text; this.children.push(child); return child; },
      addEventListener(type, callback) { this.listeners[type] = callback; }, empty() { this.children = []; } };
    return el;
  };
  class Modal { constructor(app) { this.app = app; this.modalEl = element(); this.contentEl = element(); } open() { this.onOpen(); } close() { this.onClose(); } }
  const calls = [], opened = [];
  const embed = { editMode: null, load() { calls.push('load'); }, loadFile: async () => { calls.push('loadFile'); }, showEditor() { calls.push('showEditor'); embed.editMode = {}; },
    destroyEditor(save) { calls.push('destroyEditor:' + save); }, unload() { calls.push('unload'); } };
  const app = { embedRegistry: { embedByExtension: { md: (options, file) => { calls.push('embed:' + file.path); assert.ok(options.containerEl); return embed; } } },
    workspace: { openLinkText: async (path, source, newLeaf) => { opened.push([path, newLeaf]); } } };
  const CardModal = createCardModal(Modal, () => {});
  const closed = [];
  const modal = new CardModal(app, { path: 'items/A.md' }, item => closed.push(item));
  modal.open();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(embed.editable, true);
  assert.deepEqual(calls, ['embed:items/A.md', 'load', 'loadFile', 'showEditor']);
  assert.ok(modal.modalEl.classes.includes('bkt-card-modal'));
  modal.close();
  assert.deepEqual(calls.slice(4), ['destroyEditor:true', 'unload']);
  assert.deepEqual(closed, [modal]);

  const second = new CardModal(app, { path: 'items/B.md' });
  second.open();
  const button = second.contentEl.children[0].children[0];
  button.listeners.click();
  assert.deepEqual(opened, [['items/B.md', false]]);
});
