// Minimal stand-in for the obsidian module, which ships types only.
export class Plugin {
  constructor(app) { this.app = app; this.domEvents = []; this.cleanup = []; this.events = []; }
  addCommand() {}
  async loadData() { return null; }
  async saveData() {}
  register(callback) { this.cleanup.push(callback); }
  registerEvent(event) { this.events.push(event); }
  registerDomEvent(doc, type, callback, options) {
    doc.addEventListener(type, callback, options);
    this.domEvents.push({ doc, type, callback, options });
  }
  addSettingTab(tab) { this.settingTabs = [...(this.settingTabs || []), tab]; }
}
export class Modal { constructor(app) { this.app = app; } }
export const notices = [];
export class Notice { constructor(message) { notices.push(message); } }
export class TFile { constructor(filePath) { this.path = filePath; this.parent = { path: 'items' }; this.extension = 'md'; } }
export function setIcon() {}
export const getFrontMatterInfo = text => ({ exists: true, frontmatter: text });
export const parseYaml = text => JSON.parse(text);
export let apiVersion = '1.14.4';
export function setApiVersion(v) { apiVersion = v; }
export function resetNotices() { notices.length = 0; }
