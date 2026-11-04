import { Plugin, Modal, Notice, TFile, apiVersion, getFrontMatterInfo, parseYaml, setIcon } from 'obsidian';
import { MIN_VERSION, supported, contextFor, planOrder, dropSlot, applyOrder, reorder } from './order.js';
import { CompactLayout, slotForRows, boundaryForRows } from './layout.js';
import { CollapsedStore, ColumnCollapse } from './collapse.js';
import { ScrollMemory } from './scroll.js';
import { cardContext, addMoveItems } from './move.js';
import { peekTarget, createCardModal } from './peek.js';
import { normalizeSettings } from './settings.js';
import { ToolboxSettingTab } from './settings-tab.js';

export default class BasesKanbanToolbox extends Plugin {
  async onload() {
    this.settings = normalizeSettings(await this.loadData());
    this.addSettingTab(new ToolboxSettingTab(this.app, this));
    this.active = true;
    this.busy = false;
    this.documents = new WeakSet();
    this.views = new Set();
    // The store shares the settings' collapsed object, so a toggle saves everything.
    this.collapsedStore = new CollapsedStore(this.settings.collapsed, () => void this.saveSettings());
    // Hidden from the command palette while manual order is off.
    this.addCommand({ id: 'undo-reorder', name: 'Undo last card reorder', checkCallback: checking => {
      if (!this.settings.features.manualOrder) return false;
      if (!checking) void this.undo();
      return true;
    } });
    if (!supported(apiVersion)) {
      new Notice('Bases Kanban Toolbox needs Obsidian ' + MIN_VERSION + ' or newer. Its Kanban features are disabled on this version.', 10000);
      return;
    }
    this.buildModules();
    this.CardModal = createCardModal(Modal, setIcon);
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.collapsedStore.rename(oldPath, file.path)));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      const context = this.cardMenu;
      if (this.active && this.settings.features.moveToColumn && context?.entry.file === file) addMoveItems(menu, context, (error, view, moved) => {
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
    this.registerEvent(this.app.workspace.on('css-change', () => queueMicrotask(() => { if (this.active) this.collapse?.refresh(); })));
  }
  buildModules() {
    const f = this.settings.features;
    // CompactLayout owns both compact cards and fitted columns.
    this.compact = f.compactCards || f.fitColumns ? new CompactLayout(() => this.layoutOptions()) : null;
    this.collapse = f.collapsibleColumns ? new ColumnCollapse(this.collapsedStore, setIcon) : null;
    this.scroll = f.scrollRestore ? new ScrollMemory() : null;
  }
  teardownModules() {
    this.scroll?.destroy(); this.collapse?.destroy(); this.compact?.destroy();
    this.scroll = this.collapse = this.compact = null;
  }
  layoutOptions() {
    const { features, hideWhenEmpty } = this.settings;
    return { compactCards: features.compactCards, fitColumns: features.fitColumns, hideWhenEmpty };
  }
  // The three modules wrap the same prototype methods in a fixed order, and a restore
  // only undoes the outermost wrapper, so they are rebuilt as a group. Other settings are read per event.
  applySettings(before) {
    if (!this.active || !supported(apiVersion)) return;
    const f = this.settings.features;
    if (!f.cardPopup) this.cardModal?.close();
    if (!f.manualOrder) this.clearMarker();
    const keys = ['compactCards', 'fitColumns', 'collapsibleColumns', 'scrollRestore'];
    if (keys.every(key => before.features[key] === f[key])) {
      if (before.hideWhenEmpty.join('\u0000') !== this.settings.hideWhenEmpty.join('\u0000')) this.compact?.refresh();
      return;
    }
    this.teardownModules();
    this.buildModules();
    for (const view of this.liveViews()) { this.install(view); view.updateVirtualDisplay(); }
  }
  liveViews() {
    for (const view of this.views) if (!view.containerEl?.isConnected) this.views.delete(view);
    return [...this.views];
  }
  install(view) {
    this.views.add(view);
    // Compact first so collapsing lays out after it, on top of the native pass.
    // Scroll restores last, once every column has its final height and offset.
    this.compact?.install(view);
    this.collapse?.install(view);
    this.scroll?.install(view);
  }
  registerDocuments() {
    if (!this.active) return;
    const register = doc => {
      if (!doc || this.documents.has(doc)) return;
      this.documents.add(doc);
      // Native card clicks skip prevented events, so the popup replaces navigation.
      this.registerDomEvent(doc, 'click', e => {
        const context = this.active && this.settings.features.cardPopup && this.CardModal ? peekTarget(e, this.liveViews(), this.app) : null;
        if (!context) return;
        e.preventDefault();
        this.cardModal?.close();
        this.cardModal = new this.CardModal(this.app, context.entry.file, modal => { if (this.cardModal === modal) this.cardModal = null; });
        this.cardModal.open();
      }, { capture: true });
      // Native card menus fire file-menu while this contextmenu event is dispatched.
      this.registerDomEvent(doc, 'contextmenu', e => {
        this.cardMenu = cardContext(this.liveViews(), e.target);
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
      if (view?.type === 'kanban') { this.install(view); view.updateVirtualDisplay(); }
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
  onunload() { this.active = false; this.cardModal?.close(); this.clearMarker(); this.dragContainer?.classList.remove('bkt-dragging'); this.dragContainer = null; this.teardownModules(); }
  async saveSettings() { await this.saveData(this.settings); }
  async updateSettings(mutate) {
    const before = normalizeSettings(this.settings);
    mutate(this.settings);
    this.settings = normalizeSettings(this.settings);
    this.collapsedStore.data = this.settings.collapsed;
    await this.saveSettings();
    this.applySettings(before);
  }
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
    if (!this.settings.features.manualOrder) return;
    this.clearMarker();
    if (!this.active || event.defaultPrevented) return;
    try {
      const property = this.settings.orderProperty;
      const context = contextFor(this.app, apiVersion, this.app.dragManager?.draggable, event.target, property, { allowUnsorted: this.settings.autoSort });
      if (!context) return;
      const { view, column, files, moved, groupProperty } = context;
      const top = column.innerEl.getBoundingClientRect().top;
      const layout = this.compact?.forColumn(column);
      const slot = layout ? slotForRows(event.clientY - top, layout.rows)
        : dropSlot(event.clientY, top, view.measurements.cardHeight, view.measurements.cardGap, files.length);
      // On an unsorted board, a drop that moves nothing stays native: no ranks, no sort.
      if (!context.sorted && reorder(files, moved, slot).every((file, index) => file === files[index])) return;
      const plan = planOrder(files, moved, slot, property, groupProperty, file => this.app.metadataCache.getFileCache(file)?.frontmatter);
      // Without changes, an unsorted board still needs its sort: the stored ranks may already match the new order.
      if (!plan && context.sorted) return;
      event.preventDefault();
      if (dropping) {
        event.stopPropagation();
        if (this.busy) return new Notice('The previous card reorder is still saving.');
        if (!plan) { this.sortBoard(view, property); return; }
        const sort = JSON.stringify(view.config.getSort()), group = view.config.groupBy.property;
        const entryPaths = files.map(file => file.path);
        void this.save(plan, () => view.containerEl.isConnected && JSON.stringify(view.config.getSort()) === sort
          && view.config.groupBy?.property === group && view.config.getLimit() === 0 && !view.queryController.getSearchQuery()?.trim()
          && column.group.entries.length === files.length && column.group.entries.every(entry => entryPaths.includes(entry.file.path)),
        () => column.group.entries.every((entry, index) => entry.file.path === entryPaths[index])).then(saved => {
          // Settings can change while the notes are being written; read them again before touching the .base file.
          const s = this.settings;
          if (saved && !context.sorted && this.active && s.autoSort && s.features.manualOrder && s.orderProperty === property) this.sortBoard(view, property);
        });
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
  // Resolves to true once every note is written, false otherwise.
  async save(plan, viewUnchanged = () => true, orderUnchanged = () => true) {
    if (this.busy) return false;
    this.busy = true;
    this.lastError = null;
    try {
      this.undoPlan = await applyOrder(plan, this.io(), () => this.active && supported(apiVersion) && viewUnchanged(), orderUnchanged);
      return true;
    } catch (error) {
      this.lastError = error.message;
      new Notice('Card reorder failed: ' + error.message, 10000);
      return false;
    } finally { this.busy = false; }
  }
  // The column now has ranks 1..N in the order the user made; sorting by them keeps it.
  sortBoard(view, property) {
    try {
      view.config.setSortProperty('note.' + property, 'ASC');
      new Notice('This board is now sorted by ' + property + ', so cards stay where you put them.');
    } catch (error) { new Notice('Card order saved, but the board could not be sorted by ' + property + ': ' + error.message, 10000); }
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
