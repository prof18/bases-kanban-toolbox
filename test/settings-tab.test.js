import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ToolboxSettingTab } from '../src/settings-tab.js';
import { normalizeSettings } from '../src/settings.js';

function setup(data = null) {
  const plugin = { settings: normalizeSettings(data), saves: 0 };
  plugin.updateSettings = async mutate => { mutate(plugin.settings); plugin.settings = normalizeSettings(plugin.settings); plugin.saves++; };
  return { plugin, tab: new ToolboxSettingTab({}, plugin) };
}
const items = tab => tab.getSettingDefinitions().flatMap(group => group.items);
const control = (tab, key) => items(tab).find(item => item.control.key === key).control;

test('definitions have four groups and ten settings in order', () => {
  const { tab } = setup();
  const groups = tab.getSettingDefinitions();
  assert.deepEqual(groups.map(group => [group.type, group.heading]), [['group', 'Cards'], ['group', 'Columns'], ['group', 'Card order'], ['group', 'Navigation']]);
  assert.deepEqual(groups.map(group => group.items.map(item => [item.name, item.desc, item.control.type, item.control.key, item.control.placeholder])), [
    [
      ['Compact cards', 'Wrap long titles and size each card to the properties it shows.', 'toggle', 'features.compactCards', undefined],
      ['Hide when empty', 'Comma-separated properties to hide on a card when they have no value. Needs compact cards.', 'text', 'hideWhenEmpty', 'Reference, Due'],
      ['Card popup', 'Open a card\'s note in a popup over the board instead of replacing the board.', 'toggle', 'features.cardPopup', undefined],
      ['Move to column', 'Add a Move to column item to the card menu.', 'toggle', 'features.moveToColumn', undefined],
    ],
    [
      ['Fit columns to cards', 'End each column below its last card instead of filling the board height.', 'toggle', 'features.fitColumns', undefined],
      ['Collapsible columns', 'Add a chevron to each column header that collapses the column into a narrow strip.', 'toggle', 'features.collapsibleColumns', undefined],
    ],
    [
      ['Manual card order', 'Drag a card within a column to save the column\'s order in a number property.', 'toggle', 'features.manualOrder', undefined],
      ['Order property', 'The note property that stores each card\'s place in its column.', 'text', 'orderProperty', 'Position'],
      ['Sort boards automatically', 'When you reorder a card on a board that is not sorted by the order property, sort the board by it first. This changes the sort saved in the .base file.', 'toggle', 'autoSort', undefined],
    ],
    [
      ['Restore scroll position', 'Return to the same scroll positions when you go back to a board.', 'toggle', 'features.scrollRestore', undefined],
    ],
  ]);
});

test('getControlValue returns the current value for every key', () => {
  const { tab, plugin } = setup({ hideWhenEmpty: ['Reference', 'Due'], orderProperty: 'Rank', autoSort: false, features: { cardPopup: false } });
  assert.equal(tab.getControlValue('hideWhenEmpty'), 'Reference, Due');
  assert.equal(tab.getControlValue('orderProperty'), 'Rank');
  assert.equal(tab.getControlValue('autoSort'), false);
  assert.equal(tab.getControlValue('features.cardPopup'), false);
  for (const item of items(tab)) {
    const key = item.control.key, value = tab.getControlValue(key);
    if (key.startsWith('features.')) assert.equal(value, plugin.settings.features[key.slice(9)], key);
    else assert.notEqual(value, undefined, key);
  }
});

test('setControlValue saves once and refreshes dependent rows', async () => {
  const { tab, plugin } = setup();
  await tab.setControlValue('features.cardPopup', false);
  assert.equal(plugin.settings.features.cardPopup, false);
  assert.equal(plugin.saves, 1);
  assert.equal(tab.refreshes, 1);
});

test('dependent rows are disabled while their feature is off', () => {
  const { tab, plugin } = setup();
  for (const key of ['hideWhenEmpty', 'orderProperty', 'autoSort']) assert.equal(control(tab, key).disabled(), false, key);
  plugin.settings.features.compactCards = false;
  assert.equal(control(tab, 'hideWhenEmpty').disabled(), true);
  plugin.settings.features.compactCards = true;
  plugin.settings.features.manualOrder = false;
  assert.equal(control(tab, 'orderProperty').disabled(), true);
  assert.equal(control(tab, 'autoSort').disabled(), true);
});

test('text controls store parsed values and reject an empty order property', async () => {
  const { tab, plugin } = setup();
  await tab.setControlValue('hideWhenEmpty', 'Reference, Due');
  assert.deepEqual(plugin.settings.hideWhenEmpty, ['Reference', 'Due']);
  const validate = control(tab, 'orderProperty').validate;
  assert.ok(validate(''));
  assert.ok(validate('note.'));
  assert.equal(validate(' Rank '), undefined);
  await tab.setControlValue('orderProperty', 'Rank');
  assert.equal(plugin.settings.orderProperty, 'Rank');
});

test('the tab is declarative and does not implement display()', () => {
  assert.equal(Object.hasOwn(ToolboxSettingTab.prototype, 'display'), false);
});
