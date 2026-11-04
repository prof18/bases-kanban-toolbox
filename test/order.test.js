import { test } from 'vitest';
import assert from 'node:assert/strict';
import { reorder, dropSlot, planOrder, applyOrder, contextFor, supported, sortedBy } from '../src/order.js';
const makeFiles = () => ['A', 'B', 'C'].map((name, i) => ({ path: 'items/' + name + '.md', parent: { path: 'items' }, extension: 'md', fm: { Status: 'Todo', Position: i + 1, Reference: 'keep', description: 'unchanged' } }));
const makeSizedFiles = count => Array.from({ length: count }, (_, i) => ({ path: `items/${i}.md`, parent: { path: 'items' }, extension: 'md', fm: { Status: 'Todo', Position: i + 1, Reference: `https://example.test/${i}`, description: `card ${i}`, Extra: { stable: i } } }));
const plan = files => planOrder(files, files[2], 0, 'Position', 'Status', file => file.fm);
const ioFor = files => ({ currentFile: file => files.includes(file), read: async file => ({ ...file.fm }), process: async (file, callback) => {
  const fm = { ...file.fm }; callback(fm); file.fm = fm;
} });

test('insertion boundaries handle upward, downward and adjacent drops', () => {
  assert.deepEqual(reorder(['A', 'B', 'C'], 'C', 0), ['C', 'A', 'B']);
  assert.deepEqual(reorder(['A', 'B', 'C'], 'A', 3), ['B', 'C', 'A']);
  assert.deepEqual(reorder(['A', 'B', 'C'], 'B', 2), ['A', 'B', 'C']);
  assert.throws(() => reorder(['A', 'A'], 'A', 0));
  assert.throws(() => reorder(['A'], 'A', 2));
});
test('slot geometry uses the native virtual slot rather than shortened card boxes', () => {
  assert.equal(dropSlot(500, 100, 80, 20, 10), 4);
  assert.equal(dropSlot(-50, 100, 80, 20, 10), 0);
  assert.equal(dropSlot(10000, 100, 80, 20, 10), 10);
  assert.throws(() => dropSlot(100, 0, 0, 8, 3));
});
test('saves and undoes a move without touching other properties', async () => {
  const files = makeFiles(), io = ioFor(files), original = files.map(file => ({ ...file.fm }));
  const undo = await applyOrder(plan(files), io, () => true);
  assert.deepEqual(files.map(file => file.fm.Position), [2, 3, 1]);
  for (const file of files) assert.deepEqual({ ...file.fm, Position: 0 }, { ...original[files.indexOf(file)], Position: 0 });
  await applyOrder(undo, io, () => true);
  assert.deepEqual(files.map(file => file.fm), original);
});
test('254-card save and undo preserve all non-position metadata', async () => {
  const files = makeSizedFiles(254), io = ioFor(files), original = files.map(file => structuredClone(file.fm));
  const saved = planOrder(files, files[253], 0, 'Position', 'Status', file => file.fm);
  const undo = await applyOrder(saved, io, () => true);
  assert.deepEqual(files.map(file => file.fm.Position), [...Array.from({ length: 253 }, (_, i) => i + 2), 1]);
  files.forEach((file, index) => {
    const { Position: _position, ...metadata } = file.fm;
    const { Position: _originalPosition, ...originalMetadata } = original[index];
    assert.deepEqual(metadata, originalMetadata);
  });
  await applyOrder(undo, io, () => true);
  assert.deepEqual(files.map(file => file.fm), original);
});
test('500-card limit is accepted and 501 cards are rejected by plans and native context', () => {
  const allowed = makeSizedFiles(500), rejected = makeSizedFiles(501);
  assert.ok(planOrder(allowed, allowed[499], 0, 'Position', 'Status', file => file.fm));
  assert.throws(() => planOrder(rejected, rejected[500], 0, 'Position', 'Status', file => file.fm), /column size/);

  for (const [count, expected] of [[500, true], [501, false]]) {
    const f = nativeFixture();
    const files = makeSizedFiles(count), group = { entries: files.map(file => ({ file })) };
    f.view.columns[0].group = group;
    f.drag.sourceGroup = group;
    f.drag.entry = group.entries[count - 1];
    assert.equal(Boolean(contextFor(f.app, '1.14.4', f.drag, f.target, 'Position')), expected);
  }
});
test('initializes missing ranks and undo restores absent fields', async () => {
  const files = makeFiles(); files.forEach(file => delete file.fm.Position);
  const undo = await applyOrder(plan(files), ioFor(files), () => true);
  assert.deepEqual(files.map(file => file.fm.Position), [2, 3, 1]);
  await applyOrder(undo, ioFor(files), () => true);
  assert.ok(files.every(file => !Object.hasOwn(file.fm, 'Position')));
});
test('no-op drops write nothing and nonnumeric ranks or mixed groups are rejected', () => {
  const files = makeFiles();
  assert.equal(planOrder(files, files[1], 1, 'Position', 'Status', file => file.fm), null);
  files[0].fm.Position = 'first'; assert.throws(() => plan(files), /number/);
  files[0].fm.Position = 1; files[0].fm.Status = 'Doing'; assert.throws(() => plan(files), /column changed/);
  files[0].fm.Status = ['Todo', 'Doing']; assert.throws(() => plan(files), /single-valued/);
});
test('a stale rank or status aborts before writing', async () => {
  for (const key of ['Position', 'Status']) {
    const files = makeFiles(), saved = plan(files);
    files[0].fm[key] = key === 'Position' ? 100 : 'Doing';
    await assert.rejects(applyOrder(saved, ioFor(files), () => true), /changed/);
    assert.equal(files[2].fm.Position, 3);
  }
});
test('a changed displayed order aborts before any note is written', async () => {
  const files = makeFiles(), original = files.map(file => ({ ...file.fm }));
  await assert.rejects(applyOrder(plan(files), ioFor(files), () => true, () => false), /Displayed order changed/);
  assert.deepEqual(files.map(file => file.fm), original);
});
test('disk failure restores completed writes', async () => {
  const files = makeFiles(), original = files.map(file => ({ ...file.fm })), io = ioFor(files);
  const process = io.process; let writes = 0;
  io.process = async (...args) => { if (++writes === 2) throw Error('disk failure'); return process(...args); };
  await assert.rejects(applyOrder(plan(files), io, () => true), /disk failure/);
  assert.deepEqual(files.map(file => file.fm), original);
});
test('failure halfway through a 254-card reorder rolls back every completed write', async () => {
  const files = makeSizedFiles(254), original = files.map(file => structuredClone(file.fm)), io = ioFor(files), process = io.process;
  let attempts = 0;
  io.process = async (...args) => {
    if (++attempts === 128) throw Error('mid-reorder disk failure');
    return process(...args);
  };
  await assert.rejects(applyOrder(planOrder(files, files[253], 0, 'Position', 'Status', file => file.fm), io, () => true), /mid-reorder disk failure/);
  assert.deepEqual(files.map(file => file.fm), original);
  assert.equal(attempts, 255); // 127 writes, the failed write, then 127 rollback writes.
});
test('rollback protects a concurrent edit and reports incomplete recovery', async () => {
  const files = makeFiles(), io = ioFor(files), process = io.process; let writes = 0;
  io.process = async (...args) => { if (++writes === 2) { files[2].fm.Position = 99; throw Error('disk failure'); } return process(...args); };
  await assert.rejects(applyOrder(plan(files), io, () => true), /Recovery incomplete/);
  assert.equal(files[2].fm.Position, 99);
});
test('disabling the plugin mid-save restores completed writes', async () => {
  const files = makeFiles(), original = files.map(file => ({ ...file.fm })), io = ioFor(files), process = io.process; let active = true;
  io.process = async (...args) => { await process(...args); active = false; };
  await assert.rejects(applyOrder(plan(files), io, () => active), /changed/);
  assert.deepEqual(files.map(file => file.fm), original);
});
function nativeFixture() {
  const files = makeFiles(), element = {}, app = {}, group = { entries: files.map(file => ({ file })) };
  const column = { containerEl: element, innerEl: {}, group };
  const view = { type: 'kanban', app, isReadOnly: false, columns: [column], measurements: { cardHeight: 88, cardGap: 8 },
    config: { groupBy: { property: 'Status' }, getSort: () => [{ property: 'Position', direction: 'ASC' }], getLimit: () => 0 }, queryController: { getSearchQuery: () => '' } };
  const drag = { type: 'kanban-card', view, sourceGroup: group, entry: group.entries[2] };
  const target = { closest: () => element };
  return { app, files, view, drag, target };
}
test('native adapter guards app version, search, limits, cross-column drops and sort precedence', () => {
  const f = nativeFixture(), ctx = () => contextFor(f.app, '1.14.4', f.drag, f.target, 'Position');
  assert.ok(ctx());
  assert.ok(contextFor(f.app, '1.14.5', f.drag, f.target, 'Position'));
  assert.ok(contextFor(f.app, '1.15.0', f.drag, f.target, 'Position'));
  assert.ok(contextFor(f.app, '1.14.3', f.drag, f.target, 'Position'));
  assert.equal(contextFor(f.app, '1.13.9', f.drag, f.target, 'Position'), null);
  const source = f.drag.sourceGroup; f.drag.sourceGroup = {}; assert.equal(ctx(), null); f.drag.sourceGroup = source;
  f.view.queryController.getSearchQuery = () => 'query'; assert.equal(ctx(), null); f.view.queryController.getSearchQuery = () => '';
  f.view.config.getLimit = () => 5; assert.equal(ctx(), null); f.view.config.getLimit = () => 0;
  f.view.config.getSort = () => [{ property: 'Status', direction: 'ASC' }, { property: 'Position', direction: 'ASC' }]; assert.equal(ctx(), null);
  f.view.config.getSort = () => [{ property: 'Position', direction: 'DESC' }]; assert.equal(ctx(), null);
  f.view.config.getSort = () => [{ property: 'note.Position', direction: 'ASC' }, { property: 'file.name', direction: 'ASC' }]; assert.ok(ctx());
});
test('folder groups work without project metadata and are protected from file moves', async () => {
  const files = makeFiles(), io = ioFor(files);
  const saved = planOrder(files, files[2], 0, 'Position', null, file => file.fm);
  files[0].parent.path = 'elsewhere';
  await assert.rejects(applyOrder(saved, io, () => true), /changed/);
  assert.equal(files[2].fm.Position, 3);
});

test('supported accepts 1.14.0 and later with no upper bound', () => {
  assert.equal(supported('1.14.0'), true);
  assert.equal(supported('1.13.9'), false);
  assert.equal(supported('2.0.0'), true);
});

test('sortedBy needs the order property first and ascending, and only once', () => {
  assert.equal(sortedBy([{ property: 'note.Position', direction: 'ASC' }], 'Position'), true);
  assert.equal(sortedBy([{ property: 'Position', direction: 'ASC' }], 'Position'), true);
  assert.equal(sortedBy([{ property: 'note.Position', direction: 'DESC' }], 'Position'), false);
  assert.equal(sortedBy([{ property: 'note.Status', direction: 'ASC' }, { property: 'note.Position', direction: 'ASC' }], 'Position'), false);
  assert.equal(sortedBy([], 'Position'), false);
  assert.equal(sortedBy([{ property: 'note.Position', direction: 'ASC' }, { property: 'Position', direction: 'DESC' }], 'Position'), false);
});

test('unsorted boards give a context only when allowed and the config can sort', () => {
  const f = nativeFixture();
  f.view.config.getSort = () => [{ property: 'note.Status', direction: 'ASC' }];
  assert.equal(contextFor(f.app, '1.14.4', f.drag, f.target, 'Position'), null);
  assert.equal(contextFor(f.app, '1.14.4', f.drag, f.target, 'Position', { allowUnsorted: true }), null, 'no setSortProperty');
  f.view.config.setSortProperty = () => {};
  const context = contextFor(f.app, '1.14.4', f.drag, f.target, 'Position', { allowUnsorted: true });
  assert.ok(context);
  assert.equal(context.sorted, false);
  f.view.config.getSort = () => [{ property: 'Position', direction: 'ASC' }];
  assert.equal(contextFor(f.app, '1.14.4', f.drag, f.target, 'Position').sorted, true);
});
