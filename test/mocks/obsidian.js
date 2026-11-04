// Minimal stand-in for the obsidian module, which ships types only.
export class Plugin {
  constructor(app) { this.app = app; this.domEvents = []; this.cleanup = []; this.events = []; }
  addCommand(cmd) { this.commands = [...(this.commands || []), cmd]; }
  async loadData() { return this.storedData ?? null; }
  async saveData(data) { this.saveCount = (this.saveCount || 0) + 1; this.savedData = structuredClone(data); }
  register(callback) { this.cleanup.push(callback); }
  registerEvent(event) { this.events.push(event); }
  registerDomEvent(doc, type, callback, options) {
    doc.addEventListener(type, callback, options);
    this.domEvents.push({ doc, type, callback, options });
  }
  addSettingTab(tab) { this.settingTabs = [...(this.settingTabs || []), tab]; }
}
// Every element method CardModal.onOpen calls returns another such element.
const element = () => {
  const el = { children: [] };
  for (const name of ['addClass', 'createDiv', 'createEl', 'createSpan']) el[name] = () => { const child = element(); el.children.push(child); return child; };
  el.addEventListener = () => {};
  el.empty = () => { el.children.length = 0; };
  return el;
};
export class Modal {
  constructor(app) { this.app = app; this.modalEl = element(); this.contentEl = element(); }
  open() { this.onOpen(); }
  close() { this.onClose(); }
}
export const notices = [];
export class Notice { constructor(message) { notices.push(message); } }
export class TFile { constructor(filePath) { this.path = filePath; this.parent = { path: 'items' }; this.extension = 'md'; } }
export function setIcon() {}
export const getFrontMatterInfo = text => ({ exists: true, frontmatter: text });
export const parseYaml = text => JSON.parse(text);
export let apiVersion = '1.14.4';
export function setApiVersion(v) { apiVersion = v; }
export function resetNotices() { notices.length = 0; }
export class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; }
  display() {}
  refreshDomState() { this.refreshes = (this.refreshes || 0) + 1; }
}
