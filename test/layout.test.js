import { test } from 'vitest';
import assert from 'node:assert/strict';
import { rowsFor, slotForRows, boundaryForRows, compactAllowed, CompactLayout } from '../src/layout.js';

const measurements = {
  cardHeight: 136, propHeight: 40, propGap: 8, cardGap: 8, titleHeight: 24,
  coverHeight: 120, cardPad: { top: 8 }, pad: { top: 8, bottom: 8 }, columnHeight: 32,
};
const entry = (name, reference = '') => ({ file: { path: name }, getValue: () => ({ data: reference }) });
const props = ['Name', 'Reference', 'Other'];
// These tests were written when an empty Reference was always hidden; they now ask for it.
const REFERENCE = ['Reference'];
const hideReference = () => ({ compactCards: true, fitColumns: true, hideWhenEmpty: REFERENCE });

test('rows account for each hidden Reference and preserve native inter-card gaps', () => {
  const entries = [entry('a', ''), entry('b', 'linked'), entry('c', null)];
  const layout = rowsFor(entries, props, measurements, undefined, REFERENCE);
  assert.deepEqual(layout.rows.map(row => [row.top, row.height, row.hidden]), [
    [0, 88, [false, true, false]], [96, 136, [false, false, false]], [240, 88, [false, true, false]],
  ]);
  assert.equal(layout.height, 328);
  // The property following Reference moves up into the empty row left by it.
  const emptyRow = layout.rows[0];
  assert.equal(emptyRow.hidden[2], false);
  assert.equal(rowsFor([], props, measurements, undefined, REFERENCE).height, 0);
});

test('variable row midpoints map to stable insertion slots and boundaries', () => {
  const layout = rowsFor([entry('a'), entry('b', 'x'), entry('c')], props, measurements, undefined, REFERENCE);
  const [a, b, c] = layout.rows;
  assert.deepEqual([slotForRows(a.top, layout.rows), slotForRows(a.top + a.height / 2 - .01, layout.rows), slotForRows(a.top + a.height / 2, layout.rows)], [0, 0, 1]);
  assert.deepEqual([slotForRows(b.top + b.height / 2 - .01, layout.rows), slotForRows(b.top + b.height / 2, layout.rows)], [1, 2]);
  assert.deepEqual([slotForRows(c.top + c.height / 2, layout.rows), slotForRows(10000, layout.rows)], [3, 3]);
  assert.equal(boundaryForRows(0, layout, measurements.cardGap), -4);
  assert.equal(boundaryForRows(1, layout, measurements.cardGap), a.top + a.height + 4);
  assert.equal(boundaryForRows(3, layout, measurements.cardGap), layout.height + 4);
  assert.throws(() => slotForRows(NaN, layout.rows), /coordinate/);
});

test('measured multiline titles expand rows while Reference visibility and other properties retain their space', () => {
  const entries = [
    Object.assign(entry('short-empty'), { titleHeight: 24 }),
    Object.assign(entry('long-empty'), { titleHeight: 72 }),
    Object.assign(entry('short-linked', 'url'), { titleHeight: 24 }),
    Object.assign(entry('long-linked', 'url'), { titleHeight: 72 }),
  ];
  const layout = rowsFor(entries, props, measurements, (item, firstProperty) => {
    assert.equal(firstProperty, 'Name');
    return item.titleHeight;
  }, REFERENCE);
  assert.deepEqual(layout.rows.map(row => [row.top, row.height, row.titleHeight, row.hidden]), [
    [0, 88, 24, [false, true, false]],
    [96, 136, 72, [false, true, false]],
    [240, 136, 24, [false, false, false]],
    [384, 184, 72, [false, false, false]],
  ]);
  assert.equal(layout.height, 568);
  assert.deepEqual(layout.rows.slice(1).map((row, i) => row.top - layout.rows[i].top - layout.rows[i].height), [8, 8, 8]);
  // Hiding Reference still keeps the following property; title expansion adds only its measured delta.
  assert.ok(layout.rows.every(row => row.hidden[2] === false));
  assert.equal(layout.rows[1].height - layout.rows[0].height, 48);
  assert.equal(layout.rows[3].height - layout.rows[2].height, 48);
});

test('expanded title row midpoints drive drag insertion slots and boundaries', () => {
  const layout = rowsFor([
    Object.assign(entry('short'), { titleHeight: 24 }),
    Object.assign(entry('multiline'), { titleHeight: 72 }),
    Object.assign(entry('short-again'), { titleHeight: 24 }),
  ], props, measurements, item => item.titleHeight, REFERENCE);
  const [short, multiline, last] = layout.rows;
  assert.deepEqual([short.top, short.height, multiline.top, multiline.height, last.top, last.height, layout.height], [0, 88, 96, 136, 240, 88, 328]);
  assert.equal(slotForRows(multiline.top + multiline.height / 2 - 0.01, layout.rows), 1);
  assert.equal(slotForRows(multiline.top + multiline.height / 2, layout.rows), 2);
  assert.equal(boundaryForRows(2, layout, measurements.cardGap), multiline.top + multiline.height + 4);
});

test('invalid title measurements fall back to the native title minimum', () => {
  const measured = [96, NaN, Infinity, 0, -12, 12];
  const entries = measured.map((titleHeight, index) => Object.assign(entry('title-' + index), { titleHeight }));
  const layout = rowsFor(entries, props, measurements, item => item.titleHeight, REFERENCE);
  assert.deepEqual(layout.rows.map(row => row.titleHeight), [96, 24, 24, 24, 24, 24]);
  assert.deepEqual(layout.rows.map(row => row.height), [160, 88, 88, 88, 88, 88]);
});

test('cover space and additional property rows remain in expanded card bounds', () => {
  const coverMeasurements = { ...measurements, cardHeight: measurements.cardHeight + measurements.coverHeight };
  const covered = [
    Object.assign(entry('covered-empty'), { titleHeight: 64 }),
    Object.assign(entry('covered-linked', 'url'), { titleHeight: 64 }),
  ];
  const layout = rowsFor(covered, props, coverMeasurements, item => item.titleHeight, REFERENCE);
  assert.deepEqual(layout.rows.map(row => [row.height, row.titleHeight, row.hidden]), [
    [248, 64, [false, true, false]],
    [296, 64, [false, false, false]],
  ]);
  assert.equal(layout.height, 552);
  assert.ok(layout.rows.every(row => row.hidden[2] === false));
});

test('empty Reference detection accepts all native empty value shapes', () => {
  const empty = [null, { data: null }, { data: '' }, { data: [] }];
  const rows = rowsFor(empty.map((value, i) => ({ file: { path: String(i) }, getValue: () => value })), ['Name', 'note.Reference'], measurements, undefined, REFERENCE);
  assert.ok(rows.rows.every(row => row.height === 88 && row.hidden[1]));
  const nonempty = rowsFor([entry('a', ['x'])], props, measurements, undefined, REFERENCE);
  assert.equal(nonempty.rows[0].height, 136);
});

test('compact eligibility excludes pending and cross-column moves', () => {
  const group = { entries: [{ file: { path: 'a' } }] }, moving = group.entries[0];
  const view = { data: { properties: ['Name', 'Reference'] }, cardDrag: { entry: moving, col: { group } } };
  assert.equal(compactAllowed(view), true);
  view.pendingMove = true; assert.equal(compactAllowed(view), false); delete view.pendingMove;
  view.cardDrag.col.group = { entries: [] }; assert.equal(compactAllowed(view), false);
  view.cardDrag.col = null; assert.equal(compactAllowed(view), false);
  view.cardDrag = null; assert.equal(compactAllowed(view), true);
  view.data.properties = ['Name']; assert.equal(compactAllowed(view), true);
  view.data.properties = []; assert.equal(compactAllowed(view), false);
});

function makeHarness({ covers = false } = {}) {
  const protoView = { updateVirtualDisplay() { this.nativeViewUpdates++; } };
  const protoColumn = { updateVirtualDisplay() { this.nativeColumnUpdates++; } };
  class Card {
    constructor(view) { this.view = view; this.props = []; this.el = { style: {}, setCssStyles(styles) { Object.assign(this.style, styles); } }; }
    render(itemEntry, properties) {
      this.entry = itemEntry;
      // removeProperty leaves an empty value behind, as CSSStyleDeclaration does.
      this.props = properties.map(() => ({ el: { style: { removeProperty(name) { this[name] = ''; } } } }));
    }
  }
  const entries = Array.from({ length: 30 }, (_, i) => entry('card-' + i, i % 2 ? 'link' : ''));
  const group = { entries };
  const view = Object.assign(Object.create(protoView), {
    nativeViewUpdates: 0, columns: [], unusedItems: [], imageProp: covers ? 'Cover' : null,
    measurements: { ...measurements, cardHeight: covers ? measurements.cardHeight + measurements.coverHeight : measurements.cardHeight }, data: { properties: props }, pendingMove: false, cardDrag: null,
    containerEl: { style: { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } }, isShown: () => true, isConnected: true,
      classes: new Set(), classList: { add: (...names) => names.forEach(name => view.containerEl.classes.add(name)), remove: (...names) => names.forEach(name => view.containerEl.classes.delete(name)) } },
    scrollEl: { matchParent: () => false },
  });
  const column = Object.assign(Object.create(protoColumn), {
    nativeColumnUpdates: 0, view, group, items: [new Card(view)], viewport: { top: 500, bottom: 800 },
    containerEl: { isConnected: true }, innerEl: { style: {}, setChildrenInPlace(items) { this.children = items; } },
  });
  view.columns.push(column);
  column.readViewport = () => {};
  return { protoView, protoColumn, view, column, entries };
}

test('virtualization lays out only visible native cards, reuses offscreen cards, and preserves cover offset', () => {
  const h = makeHarness({ covers: true }), manager = new CompactLayout(hideReference);
  manager.install(h.view);
  h.view.updateVirtualDisplay();
  const expectedLayout = rowsFor(h.entries, props, h.view.measurements, undefined, REFERENCE);
  assert.equal(manager.forColumn(h.column).height, expectedLayout.height);
  assert.ok(h.column.items.length > 0 && h.column.items.length < h.entries.length);
  assert.deepEqual(h.column.items.map(card => card.entry), expectedLayout.rows.filter(row => row.top <= 800 && row.top + row.height >= 500).map(row => row.entry));
  const first = h.column.items[0], row = expectedLayout.rows.find(row => row.entry === first.entry);
  assert.equal(first.props[0].el.style.top, '128px');
  assert.equal(first.props[2].el.style.top, row.hidden[1] ? '160px' : '208px');
  assert.equal(first.props[1].el.style.display, row.hidden[1] ? 'none' : '');
  assert.equal(first.el.style.minHeight, row.height + 'px');
  const poolBefore = h.view.unusedItems.length;
  h.column.viewport = { top: 0, bottom: 120 };
  h.column.updateVirtualDisplay();
  assert.ok(h.view.unusedItems.length > 0 && h.column.items.some(card => card.entry === h.entries[0]));
  assert.ok(poolBefore > 0);
  manager.destroy();
});

test('embedded Bases height follows the tallest compact column', () => {
  const h = makeHarness();
  h.view.scrollEl.matchParent = selector => selector === '.block-language-base,.bases-embed';
  h.view.columns.push({
    group: { entries: [entry('short', 'linked')] },
    containerEl: { isConnected: false }, items: [],
  });
  const manager = new CompactLayout(hideReference);
  manager.install(h.view);
  h.view.updateVirtualDisplay();
  const tallest = Math.max(...h.view.columns.map(column => rowsFor(column.group.entries, props, h.view.measurements, undefined, REFERENCE).height));
  assert.equal(h.view.containerEl.style.height, measurements.pad.top + measurements.columnHeight + tallest + measurements.pad.bottom + 'px');
  manager.destroy();
});

test('wrapped titles shift following properties and virtual rows without losing cover space', () => {
  const h = makeHarness({ covers: true }), manager = new CompactLayout(hideReference);
  manager.titleMeasurer = () => ({ measure: () => 64, detach() {} });
  manager.install(h.view); h.view.updateVirtualDisplay();
  const layout = rowsFor(h.entries, props, h.view.measurements, () => 64, REFERENCE);
  assert.equal(manager.forColumn(h.column).height, layout.height);
  for (const card of h.column.items) {
    const row = layout.rows.find(r => r.entry === card.entry);
    assert.equal(card.props[0].el.style.height, '64px');
    assert.equal(card.props[2].el.style.top, row.hidden[1] ? '200px' : '248px');
    assert.equal(card.el.style.top, row.top + 'px');
    assert.equal(card.el.style.minHeight, row.height + 'px');
  }
  manager.destroy();
});

test('embedded height includes title expansion and title-only views also wrap', () => {
  const h = makeHarness(), manager = new CompactLayout(hideReference);
  h.view.data.properties = ['Name'];
  h.view.measurements.cardHeight = 40;
  h.view.scrollEl.matchParent = () => true;
  manager.titleMeasurer = () => ({ measure: () => 64, detach() {} });
  manager.install(h.view); h.view.updateVirtualDisplay();
  const layout = rowsFor(h.entries, ['Name'], h.view.measurements, () => 64, REFERENCE);
  assert.equal(h.view.containerEl.style.height, measurements.pad.top + measurements.columnHeight + layout.height + measurements.pad.bottom + 'px');
  assert.ok(h.column.items.every(card => card.el.style.minHeight === '80px'));
  manager.destroy();
});

test('fallback handles pending or cross-column move and destroy restores prototypes and styles', () => {
  const h = makeHarness(), manager = new CompactLayout(hideReference);
  const originalView = h.protoView.updateVirtualDisplay, originalColumn = h.protoColumn.updateVirtualDisplay;
  manager.install(h.view); h.view.updateVirtualDisplay();
  assert.notEqual(h.protoColumn.updateVirtualDisplay, originalColumn);
  assert.ok(h.view.containerEl.classes.has('bkt-fit'), 'columns fit their content');
  assert.equal(h.view.containerEl.style['--bkt-pad-block'], measurements.pad.top + measurements.pad.bottom + 'px');
  const compactItems = h.column.items;
  h.view.pendingMove = true;
  h.column.updateVirtualDisplay();
  assert.equal(h.column.nativeColumnUpdates, 1);
  assert.equal(manager.forColumn(h.column), null);
  h.view.pendingMove = false;
  h.view.cardDrag = { entry: h.entries[0], col: { group: { entries: [] } } };
  h.column.updateVirtualDisplay();
  assert.equal(h.column.nativeColumnUpdates, 2);
  h.view.cardDrag = null;
  manager.destroy();
  assert.equal(h.protoView.updateVirtualDisplay, originalView);
  assert.equal(h.protoColumn.updateVirtualDisplay, originalColumn);
  assert.equal(h.view.containerEl.classes.has('bkt-fit'), false);
  for (const card of [...compactItems, ...h.view.unusedItems]) for (const prop of card.props) assert.equal(prop.el.style.display, '');
});

test('titles are not measured until the wrap styles apply, then the layout refreshes', () => {
  const frames = [];
  let whiteSpace = 'nowrap';
  const win = { getComputedStyle: () => ({ whiteSpace, font: '15px x', lineHeight: '21px', letterSpacing: 'normal', wordSpacing: '0px', padding: '0px', borderWidth: '0px', boxSizing: 'border-box' }),
    requestAnimationFrame: callback => frames.push(callback) };
  const line = { ownerDocument: { defaultView: win, createElement: () => ({ style: {}, remove() {} }) }, closest: () => ({ classList: { add() {} } }) };
  const view = { measurements: { cardPad: { start: 0, end: 0 } }, columns: [] };
  const column = { view, items: [{ props: [{ lineEl: line }] }], innerEl: { clientWidth: 262 } };
  const manager = new CompactLayout(hideReference);
  let refreshes = 0;
  manager.refresh = () => { refreshes++; };
  assert.equal(manager.titleMeasurer(column), null);
  assert.equal(manager.titleMeasurer(column), null);
  assert.equal(frames.length, 1, 'one retry is queued at a time');
  frames.shift()();
  assert.equal(refreshes, 1);
  whiteSpace = 'normal';
  assert.equal(typeof manager.titleMeasurer(column)?.measure, 'function');
  assert.equal(frames.length, 0);
});

test('compact cards off keeps fitted columns but lays cards out natively', () => {
  const h = makeHarness(), manager = new CompactLayout(() => ({ compactCards: false, fitColumns: true, hideWhenEmpty: [] }));
  manager.install(h.view); h.view.updateVirtualDisplay();
  assert.ok(h.view.containerEl.classes.has('bkt-fit'));
  assert.equal(manager.forColumn(h.column), null);
  manager.destroy();
});

test('fitted columns off removes the fit class and pad but keeps compact cards', () => {
  const options = { compactCards: true, fitColumns: true, hideWhenEmpty: [] };
  const h = makeHarness(), manager = new CompactLayout(() => options);
  manager.install(h.view); h.view.updateVirtualDisplay();
  assert.ok(h.view.containerEl.classes.has('bkt-fit'));
  assert.notEqual(h.view.containerEl.style['--bkt-pad-block'], undefined);
  options.fitColumns = false;
  h.view.updateVirtualDisplay();
  assert.equal(h.view.containerEl.classes.has('bkt-fit'), false);
  assert.equal(h.view.containerEl.style['--bkt-pad-block'], undefined);
  assert.ok(manager.forColumn(h.column));
  manager.destroy();
});

test('columns that are plain objects never patch Object.prototype', () => {
  const protoView = { updateVirtualDisplay() {} };
  const view = Object.assign(Object.create(protoView), { columns: [{ view: null, items: [] }], unusedItems: [], data: { properties: props }, measurements,
    containerEl: { style: { setProperty() {} }, isShown: () => false, classList: { add() {}, remove() {} } }, scrollEl: { matchParent: () => false } });
  const manager = new CompactLayout(hideReference);
  manager.install(view);
  view.updateVirtualDisplay();
  assert.equal(Object.prototype.updateVirtualDisplay, undefined);
  manager.destroy();
});

const card = values => ({ file: { path: 'x' }, getValue: prop => ({ data: values[prop] ?? '' }) });
const hiddenFor = (properties, values, hideWhenEmpty) => rowsFor([card(values)], properties, measurements, undefined, hideWhenEmpty).rows[0].hidden;

test('nothing is hidden without a hide-when-empty list, even an empty Reference', () => {
  assert.deepEqual(hiddenFor(['Name', 'note.Reference'], {}), [false, false]);
});

test('listed properties hide when empty, with or without the note. prefix', () => {
  assert.deepEqual(hiddenFor(['Name', 'note.Reference', 'Reference'], {}, ['Reference']), [false, true, true]);
  assert.deepEqual(hiddenFor(['Name', 'note.Reference'], { 'note.Reference': 'link' }, ['Reference']), [false, false]);
  assert.deepEqual(hiddenFor(['Name', 'note.Due', 'note.Reference'], {}, ['Due']), [false, true, false]);
});

test('the title is never hidden', () => {
  assert.deepEqual(hiddenFor(['note.Due', 'Other'], {}, ['Due']), [false, false]);
});

test('values without data, like dates, hide only when they are null', () => {
  // Shapes seen in Obsidian 1.15: a date has date and time but no data; a missing value is falsy with no data.
  const date = { date: new Date(0), time: true, isTruthy: () => true, toString: () => '1970-01-01' };
  const missing = { isTruthy: () => false, toString: () => 'null' };
  assert.deepEqual(rowsFor([{ file: { path: 'd' }, getValue: () => date }], ['Name', 'note.Due'], measurements, undefined, ['Due']).rows[0].hidden, [false, false]);
  assert.deepEqual(rowsFor([{ file: { path: 'm' }, getValue: () => missing }], ['Name', 'note.Due'], measurements, undefined, ['Due']).rows[0].hidden, [false, true]);
});
