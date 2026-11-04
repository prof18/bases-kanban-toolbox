import { Plugin, Modal, Notice, TFile, apiVersion, getFrontMatterInfo, parseYaml, setIcon } from 'obsidian';
import { MIN_VERSION, supported, contextFor, planOrder, dropSlot, applyOrder } from './order.js';
import { CompactLayout, slotForRows, boundaryForRows } from './layout.js';
import { CollapsedStore, ColumnCollapse } from './collapse.js';
import { ScrollMemory } from './scroll.js';
import { cardContext, addMoveItems } from './move.js';
import { peekTarget, createCardModal } from './peek.js';
const PROPERTY = 'Position';

export default class BasesKanbanToolbox extends Plugin {
  onload() {
    this.active = true;
    this.busy = false;
    this.documents = new WeakSet();
    this.addCommand({ id: 'undo-reorder', name: 'Undo last card reorder', callback: () => this.undo() });
    if (!supported(apiVersion)) {
      new Notice('Bases Kanban Toolbox needs Obsidian ' + MIN_VERSION + ' or newer. Its Kanban features are disabled on this version.', 10000);
      return;
    }
    this.compact = new CompactLayout();
    this.collapsedStore = new CollapsedStore({}, data => this.saveData({ ...this.settings, collapsed: data }));
    this.collapse = new ColumnCollapse(this.collapsedStore, setIcon);
    this.scroll = new ScrollMemory();
    this.CardModal = createCardModal(Modal, setIcon);
    void this.loadData().then(settings => {
      this.settings = settings || {};
      Object.assign(this.collapsedStore.data, this.settings.collapsed || {});
      if (this.active) this.collapse.refresh();
    });
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.collapsedStore.rename(oldPath, file.path)));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      const context = this.cardMenu;
      if (this.active && context?.entry.file === file) addMoveItems(menu, context, (error, view, moved) => {
        if (typeof view.showError === 'function') view.showError(error, moved); else new Notice('Card not moved: ' + error.message, 8000);
      });
    }));
    const registration = this.app.internalPlugins.plugins.bases?.instance?.registrations?.kanban;
    if (registration?.factory) {
      const factory = registration.factory;
      const wrapper = (...args) => { const view = factory(...args); this.install(view); return view; };
      registration.factory = wrapper;
      this.register(() => { if (registration.factory === wrapper) registration.factory = factory; });
    }
    this.app.workspace.onLayoutReady(() => { if (this.active) this.registerDocuments(); });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.registerDocuments()));
    this.registerEvent(this.app.workspace.on('window-open', () => this.registerDocuments()));
    this.registerEvent(this.app.workspace.on('css-change', () => queueMicrotask(() => { if (this.active) this.collapse.refresh(); })));
  }
  install(view) {
    // Compact first so collapsing lays out after it, on top of the native pass.
    // Scroll restores last, once every column has its final height and offset.
    this.compact.install(view);
    this.collapse.install(view);
    this.scroll.install(view);
  }
  registerDocuments() {
    if (!this.active) return;
    const register = doc => {
      if (!doc || this.documents.has(doc)) return;
      this.documents.add(doc);
      // Native card clicks skip prevented events, so the popup replaces navigation.
      this.registerDomEvent(doc, 'click', e => {
        const context = this.active && this.compact && this.CardModal ? peekTarget(e, this.compact.views, this.app) : null;
        if (!context) return;
        e.preventDefault();
        this.cardModal?.close();
        this.cardModal = new this.CardModal(this.app, context.entry.file, modal => { if (this.cardModal === modal) this.cardModal = null; });
        this.cardModal.open();
      }, { capture: true });
      // Native card menus fire file-menu while this contextmenu event is dispatched.
      this.registerDomEvent(doc, 'contextmenu', e => {
        this.cardMenu = this.compact ? cardContext(this.compact.views, e.target) : null;
        if (this.cardMenu) window.setTimeout(() => { this.cardMenu = null; }, 0);
      }, { capture: true });
      this.registerDomEvent(doc, 'dragstart', () => queueMicrotask(() => this.markDragging()), { capture: true });
      this.registerDomEvent(doc, 'dragover', e => { this.markDragging(); this.handleDrag(e, false); }, { capture: true });
      this.registerDomEvent(doc, 'drop', e => { this.handleDrag(e, true); this.endDragging(); }, { capture: true });
      this.registerDomEvent(doc, 'dragend', () => { this.clearMarker(); this.endDragging(); }, { capture: true });
      this.registerDomEvent(doc, 'touchend', () => { this.clearMarker(); this.endDragging(); }, { capture: true, passive: true });
      this.registerDomEvent(doc, 'touchcancel', () => { this.clearMarker(); this.endDragging(); }, { capture: true, passive: true });
      this.registerDomEvent(doc, 'dragleave', e => { if (!e.relatedTarget) this.clearMarker(); }, { capture: true });
    };
    register(this.app.workspace.containerEl.ownerDocument);
    this.app.workspace.iterateAllLeaves(leaf => register(leaf.view.containerEl?.ownerDocument));
    this.app.workspace.iterateAllLeaves(leaf => {
      const view = leaf.view.controller?.view;
      if (view?.type === 'kanban' && this.compact) { this.install(view); view.updateVirtualDisplay(); }
    });
    this.compact?.refresh();
  }
  // Fitted columns are short drop targets, so they fill the board while a card is dragged.
  markDragging() {
    const draggable = this.app.dragManager?.draggable;
    const container = draggable?.type === 'kanban-card' ? draggable.view?.containerEl : null;
    if (!this.active || !container || container === this.dragContainer) return;
    this.endDragging();
    this.dragContainer = container;
    container.classList.add('bkt-dragging');
  }
  endDragging() {
    const container = this.dragContainer;
    this.dragContainer = null;
    // After native drop handlers, which already resolved their target column.
    if (container) window.setTimeout(() => container.classList.remove('bkt-dragging'), 0);
  }
  onunload() { this.active = false; this.cardModal?.close(); this.clearMarker(); this.dragContainer?.classList.remove('bkt-dragging'); this.dragContainer = null; this.scroll?.destroy(); this.collapse?.destroy(); this.compact?.destroy(); }
  clearMarker() { this.marker?.remove(); this.marker = null; }
  io() {
    return {
      currentFile: file => file instanceof TFile && this.app.vault.getAbstractFileByPath(file.path) === file,
      read: async file => {
        const info = getFrontMatterInfo(await this.app.vault.read(file));
        return info.exists ? parseYaml(info.frontmatter) || {} : {};
      },
      process: (file, callback) => this.app.fileManager.processFrontMatter(file, callback)
    };
  }
  handleDrag(event, dropping) {
    this.clearMarker();
    if (!this.active || event.defaultPrevented) return;
    try {
      const context = contextFor(this.app, apiVersion, this.app.dragManager?.draggable, event.target, PROPERTY);
      if (!context) return;
      const { view, column, files, moved, groupProperty } = context;
      const top = column.innerEl.getBoundingClientRect().top;
      const layout = this.compact?.forColumn(column);
      const slot = layout ? slotForRows(event.clientY - top, layout.rows)
        : dropSlot(event.clientY, top, view.measurements.cardHeight, view.measurements.cardGap, files.length);
      const plan = planOrder(files, moved, slot, PROPERTY, groupProperty, file => this.app.metadataCache.getFileCache(file)?.frontmatter);
      if (!plan) return;
      event.preventDefault();
      if (dropping) {
        event.stopPropagation();
        if (this.busy) return new Notice('The previous card reorder is still saving.');
        const sort = JSON.stringify(view.config.getSort()), group = view.config.groupBy.property;
        const entryPaths = files.map(file => file.path);
        void this.save(plan, () => view.containerEl.isConnected && JSON.stringify(view.config.getSort()) === sort
          && view.config.groupBy?.property === group && view.config.getLimit() === 0 && !view.queryController.getSearchQuery()?.trim()
          && column.group.entries.length === files.length && column.group.entries.every(entry => entryPaths.includes(entry.file.path)),
        () => column.group.entries.every((entry, index) => entry.file.path === entryPaths[index]));
      } else {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        const rect = column.contentEl.getBoundingClientRect();
        const y = top + (layout ? boundaryForRows(slot, layout, view.measurements.cardGap)
          : slot * (view.measurements.cardHeight + view.measurements.cardGap) - view.measurements.cardGap / 2);
        if (y < rect.top || y > rect.bottom) return;
        const doc = event.target.ownerDocument;
        this.marker = doc.createElement('div');
        this.marker.className = 'bkt-order-marker';
        Object.assign(this.marker.style, { top: y + 'px', left: rect.left + 'px', width: rect.width + 'px' });
        doc.body.appendChild(this.marker);
      }
    } catch (error) { if (dropping) new Notice('Card order unchanged: ' + error.message, 8000); }
  }
  async save(plan, viewUnchanged = () => true, orderUnchanged = () => true) {
    if (this.busy) return;
    this.busy = true;
    this.lastError = null;
    try {
      this.undoPlan = await applyOrder(plan, this.io(), () => this.active && supported(apiVersion) && viewUnchanged(), orderUnchanged);
    } catch (error) {
      this.lastError = error.message;
      new Notice('Card reorder failed: ' + error.message, 10000);
    } finally { this.busy = false; }
  }
  async undo() {
    if (this.busy) return new Notice('Wait for the current reorder to finish.');
    if (!this.undoPlan) return new Notice('No card reorder to undo in this session.');
    this.busy = true;
    try {
      await applyOrder(this.undoPlan, this.io(), () => this.active && supported(apiVersion));
      this.undoPlan = null;
      new Notice('Last card reorder undone.');
    } catch (error) { new Notice('Cannot undo card reorder: ' + error.message, 10000); }
    finally { this.busy = false; }
  }
}
