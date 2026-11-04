import { PluginSettingTab } from 'obsidian';
import { formatPropertyList, parsePropertyList } from './settings.js';

// Declarative settings (Obsidian 1.13+): Obsidian renders the tab and indexes it for settings search.
export class ToolboxSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  getSettingDefinitions() {
    const features = () => this.plugin.settings.features;
    return [
      { type: 'group', heading: 'Cards', items: [
        { name: 'Compact cards', desc: 'Wrap long titles and size each card to the properties it shows.', control: { type: 'toggle', key: 'features.compactCards' } },
        { name: 'Hide when empty', desc: 'Comma-separated properties to hide on a card when they have no value. Needs compact cards.',
          control: { type: 'text', key: 'hideWhenEmpty', placeholder: 'Reference, Due', disabled: () => !features().compactCards } },
        { name: 'Card popup', desc: 'Open a card\'s note in a popup over the board instead of replacing the board.', control: { type: 'toggle', key: 'features.cardPopup' } },
        { name: 'Move to column', desc: 'Add a Move to column item to the card menu.', control: { type: 'toggle', key: 'features.moveToColumn' } },
      ] },
      { type: 'group', heading: 'Columns', items: [
        { name: 'Fit columns to cards', desc: 'End each column below its last card instead of filling the board height.', control: { type: 'toggle', key: 'features.fitColumns' } },
        { name: 'Collapsible columns', desc: 'Add a chevron to each column header that collapses the column into a narrow strip.', control: { type: 'toggle', key: 'features.collapsibleColumns' } },
      ] },
      { type: 'group', heading: 'Card order', items: [
        { name: 'Manual card order', desc: 'Drag a card within a column to save the column\'s order in a number property.', control: { type: 'toggle', key: 'features.manualOrder' } },
        { name: 'Order property', desc: 'The note property that stores each card\'s place in its column.',
          control: { type: 'text', key: 'orderProperty', placeholder: 'Position',
            validate: value => (value.trim().replace(/^note\./, '') ? undefined : 'Enter a property name.'), disabled: () => !features().manualOrder } },
        { name: 'Sort boards automatically', desc: 'When you reorder a card on a board that is not sorted by the order property, sort the board by it first. This changes the sort saved in the .base file.',
          control: { type: 'toggle', key: 'autoSort', disabled: () => !features().manualOrder } },
      ] },
      { type: 'group', heading: 'Navigation', items: [
        { name: 'Restore scroll position', desc: 'Return to the same scroll positions when you go back to a board.', control: { type: 'toggle', key: 'features.scrollRestore' } },
      ] },
    ];
  }
  getControlValue(key) {
    const s = this.plugin.settings;
    if (key.startsWith('features.')) return s.features[key.slice(9)];
    if (key === 'hideWhenEmpty') return formatPropertyList(s.hideWhenEmpty);
    return s[key];
  }
  async setControlValue(key, value) {
    await this.plugin.updateSettings(s => {
      if (key.startsWith('features.')) s.features[key.slice(9)] = value;
      else if (key === 'hideWhenEmpty') s.hideWhenEmpty = parsePropertyList(value);
      else s[key] = value;
    });
    // Dependent rows (Hide when empty, Order property, Sort boards automatically) re-check disabled.
    this.refreshDomState();
  }
}
