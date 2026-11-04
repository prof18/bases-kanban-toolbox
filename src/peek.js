import { cardContext } from './move.js';

// A plain click or tap on a card opens its note in a popup instead of replacing
// the board in its tab. The popup hosts Obsidian's editable note embed, the one
// Canvas uses for file cards: inline title, properties and live preview.
// Links inside a card and modifier clicks keep the native behaviour.
export function embedFactory(app) {
  const factory = app?.embedRegistry?.embedByExtension?.md;
  return typeof factory === 'function' ? factory : null;
}
export function peekTarget(event, views, app) {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  if (!target?.closest || target.closest('a, input, textarea, [contenteditable="true"]')) return null;
  const context = cardContext(views, target);
  if (!context || context.entry.file?.extension !== 'md' || !embedFactory(app)) return null;
  // Same rule as native: a click that ends a text selection inside the card does nothing.
  const cardEl = target.closest('.bases-kanban-card'), selection = cardEl.ownerDocument?.defaultView?.getSelection?.();
  for (let i = 0; i < (selection?.rangeCount || 0); i++) {
    const range = selection.getRangeAt(i);
    if (!range.collapsed && (cardEl.contains(range.startContainer) || cardEl.contains(range.endContainer))) return null;
  }
  return context;
}

export function createCardModal(Modal, setIcon) {
  return class CardModal extends Modal {
    constructor(app, file, onClosed = () => {}) { super(app); this.file = file; this.embed = null; this.onClosed = onClosed; }
    onOpen() {
      this.modalEl.addClass('bkt-card-modal');
      const actions = this.contentEl.createDiv('bkt-card-actions');
      const open = actions.createEl('button', { cls: 'bkt-card-open', attr: { 'aria-label': 'Open note' } });
      setIcon(open.createSpan(), 'lucide-file-input');
      open.createSpan({ text: 'Open note' });
      open.addEventListener('click', () => {
        const path = this.file.path;
        this.close();
        // Same as a native card click; Back returns to the board where it was.
        void this.app.workspace.openLinkText(path, '', false);
      });
      const host = this.contentEl.createDiv('bkt-card-note markdown-embed');
      const embed = this.embed = embedFactory(this.app)({ app: this.app, containerEl: host, state: {} }, this.file, '');
      embed.editable = true;
      embed.load();
      void Promise.resolve(embed.loadFile()).then(() => {
        if (this.embed === embed && typeof embed.showEditor === 'function') embed.showEditor();
      });
    }
    onClose() {
      const embed = this.embed;
      this.embed = null;
      if (embed) {
        // Writes pending edits now instead of after the save debounce.
        if (embed.editMode && typeof embed.destroyEditor === 'function') embed.destroyEditor(true);
        embed.unload();
      }
      this.contentEl.empty();
      this.onClosed(this);
    }
  };
}
