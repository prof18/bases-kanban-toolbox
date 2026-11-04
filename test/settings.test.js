import { test } from 'vitest';
import assert from 'node:assert/strict';
import { FEATURE_KEYS, DEFAULT_SETTINGS, normalizeSettings, parsePropertyList, formatPropertyList } from '../src/settings.js';

const defaults = () => ({
  features: { compactCards: true, fitColumns: true, manualOrder: true, cardPopup: true, moveToColumn: true, collapsibleColumns: true, scrollRestore: true },
  orderProperty: 'Position', autoSort: true, hideWhenEmpty: [], collapsed: {},
});

test('missing or empty data gets the documented defaults', () => {
  assert.deepEqual(normalizeSettings(null), defaults());
  assert.deepEqual(normalizeSettings(undefined), defaults());
  assert.deepEqual(normalizeSettings({}), defaults());
  assert.deepEqual(normalizeSettings([]), defaults());
  assert.deepEqual(normalizeSettings('x'), defaults());
  assert.deepEqual(DEFAULT_SETTINGS, defaults());
  assert.deepEqual(FEATURE_KEYS, Object.keys(defaults().features));
});

test('normalizing builds fresh objects every time', () => {
  const a = normalizeSettings(null), b = normalizeSettings(null);
  assert.notEqual(a.features, b.features);
  assert.notEqual(a.hideWhenEmpty, b.hideWhenEmpty);
  assert.notEqual(a.collapsed, b.collapsed);
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
});

test('legacy data with only collapsed keeps it and gets default features', () => {
  const settings = normalizeSettings({ collapsed: { 'a.base\u0000V': ['done'] } });
  assert.deepEqual(settings.collapsed, { 'a.base\u0000V': ['done'] });
  assert.deepEqual(settings.features, defaults().features);
});

test('invalid types fall back to defaults', () => {
  assert.equal(normalizeSettings({ features: { cardPopup: 'no' } }).features.cardPopup, true);
  assert.equal(normalizeSettings({ features: { cardPopup: false } }).features.cardPopup, false);
  assert.equal(normalizeSettings({ orderProperty: '  note.Rank ' }).orderProperty, 'Rank');
  assert.equal(normalizeSettings({ orderProperty: '' }).orderProperty, 'Position');
  assert.equal(normalizeSettings({ orderProperty: 'note.' }).orderProperty, 'Position');
  assert.equal(normalizeSettings({ orderProperty: 4 }).orderProperty, 'Position');
  assert.equal(normalizeSettings({ autoSort: 'off' }).autoSort, true);
  assert.equal(normalizeSettings({ autoSort: false }).autoSort, false);
  assert.deepEqual(normalizeSettings({ hideWhenEmpty: 'Reference' }).hideWhenEmpty, []);
  assert.deepEqual(normalizeSettings({ collapsed: [] }).collapsed, {});
});

test('hideWhenEmpty keeps trimmed unique strings without the note. prefix', () => {
  assert.deepEqual(normalizeSettings({ hideWhenEmpty: ['Reference', ' note.Due ', '', 'Reference', 3] }).hideWhenEmpty, ['Reference', 'Due']);
});

test('collapsed drops entries that are not arrays of strings', () => {
  assert.deepEqual(normalizeSettings({ collapsed: { k: ['a', 1], ok: ['b'], bad: 'c' } }).collapsed, { ok: ['b'] });
});

test('unknown keys are dropped', () => {
  const settings = normalizeSettings({ extra: 1, features: { compactCards: false, other: true } });
  assert.equal('extra' in settings, false);
  assert.equal('other' in settings.features, false);
  assert.equal(settings.features.compactCards, false);
});

test('property lists parse from and format to comma-separated text', () => {
  assert.deepEqual(parsePropertyList(' Reference, ,note.Due '), ['Reference', 'Due']);
  assert.deepEqual(parsePropertyList(''), []);
  assert.equal(formatPropertyList(['Reference', 'Due']), 'Reference, Due');
  assert.equal(formatPropertyList([]), '');
});
