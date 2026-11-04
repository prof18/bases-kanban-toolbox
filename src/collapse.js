import { patchMethod } from './patch.js';

export const COLLAPSED_WIDTH = 44;
const CLASS = 'bkt-collapsed';

export function viewKey(view) {
  // query.file is the .base file, or the note holding an inline base block.
  const path = view.queryController?.query?.file?.path;
  const name = view.config?.getViewName?.();
  return typeof path === 'string' && typeof name === 'string' ? path + '\u0000' + name : null;
}
export function groupKey(group) {
  return group?.key == null ? '' : String(group.key);
}
// Inline offsets of each column, left to right, given which ones are collapsed.
export function columnOffsets(collapsed, start, width, gap) {
  let offset = start;
  const columns = collapsed.map(isCollapsed => {
    const column = { start: offset, width: isCollapsed ? COLLAPSED_WIDTH : width };
    offset += column.width + gap;
    return column;
  });
  return { columns, end: offset };
}

// Collapsed state lives in plugin data, keyed by Base file and view name, so the
// .base file itself is never edited.
export class CollapsedStore {
  constructor(data = {}, save = () => {}) { this.data = data && typeof data === 'object' ? data : {}; this.save = save; }
  has(view, group) {
    const key = viewKey(view);
    return key !== null && Array.isArray(this.data[key]) && this.data[key].includes(groupKey(group));
  }
  toggle(view, group) {
    const key = viewKey(view);
    if (key === null) return false;
    const groups = new Set(this.data[key] || []), id = groupKey(group);
    if (groups.has(id)) groups.delete(id); else groups.add(id);
    if (groups.size) this.data[key] = [...groups]; else delete this.data[key];
    this.save(this.data);
    return groups.has(id);
  }
  rename(oldPath, newPath) {
    let changed = false;
    for (const key of Object.keys(this.data)) {
      if (!key.startsWith(oldPath + '\u0000')) continue;
      this.data[newPath + key.slice(oldPath.length)] = this.data[key];
      delete this.data[key];
      changed = true;
    }
    if (changed) this.save(this.data);
  }
}

// Native Kanban gives every column the same width and only attaches the columns
// in the viewport. Views with a collapsed column are laid out again after the
// native pass, with narrow strips and every column attached.
export class ColumnCollapse {
  constructor(store, setIcon) { this.store = store; this.setIcon = setIcon; this.restores = []; this.views = new Set(); this.headers = new WeakSet(); }
  install(view) {
    if (this.viewPrototype) return;
    const prototype = Object.getPrototypeOf(view), original = prototype.updateVirtualDisplay;
    if (typeof original !== 'function') return;
    this.viewPrototype = prototype;
    this.restores.push(patchMethod(prototype, 'updateVirtualDisplay', this, (manager, instance, method, args) => {
      const result = method.apply(instance, args);
      manager.layout(instance);
      return result;
    }));
  }
  installColumns(view) {
    if (this.columnPrototype || !view.columns?.length) return;
    const prototype = Object.getPrototypeOf(view.columns[0]), original = prototype.render;
    if (typeof original !== 'function' || !view.columns[0].headerEl) return;
    this.columnPrototype = prototype;
    this.restores.push(patchMethod(prototype, 'render', this, (manager, column, method, args) => {
      const result = method.apply(column, args);
      manager.decorate(column);
      return result;
    }));
    // Columns rendered before the wrapper existed get their toggle now.
    for (const known of this.views) known.columns?.forEach(column => this.decorate(column));
  }
  decorate(column) {
    const header = column.headerEl, view = column.view;
    if (!header || !column.group || viewKey(view) === null) return;
    const collapsed = this.store.has(view, column.group);
    column.containerEl.classList.toggle(CLASS, collapsed);
    if (!this.headers.has(header)) {
      this.headers.add(header);
      // A collapsed strip is mostly header, so the whole strip expands it.
      header.addEventListener('click', event => {
        if (column.group && column.containerEl.classList.contains(CLASS) && !event.defaultPrevented) this.toggle(column);
      });
    }
    let button = header.querySelector(':scope > .bkt-collapse');
    if (!button) {
      button = header.ownerDocument.createElement('div');
      button.className = 'bkt-collapse clickable-icon';
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (column.group) this.toggle(column); });
      header.prepend(button);
    }
    this.setIcon(button, collapsed ? 'lucide-chevron-right' : 'lucide-chevron-down');
    button.setAttribute('aria-label', collapsed ? 'Expand column' : 'Collapse column');
  }
  toggle(column) {
    this.store.toggle(column.view, column.group);
    column.view.columns.forEach(item => this.decorate(item));
    column.view.updateVirtualDisplay();
  }
  layout(view) {
    this.views.add(view);
    this.installColumns(view);
    const container = view.containerEl, measurements = view.measurements;
    if (!view.data || !Array.isArray(view.columns) || !container?.isShown?.() || !measurements) return;
    const collapsed = view.columns.map(column => Boolean(column.group) && this.store.has(view, column.group));
    view.columns.forEach((column, index) => {
      if (column.containerEl.classList.contains(CLASS) !== collapsed[index] || !column.headerEl?.querySelector(':scope > .bkt-collapse')) this.decorate(column);
    });
    if (!collapsed.some(Boolean)) return;
    // Mirror the native preview of a column being dragged to a new index.
    const order = view.columns.slice(), drag = view.columnDrag;
    if (drag) {
      const from = order.findIndex(column => column.group && groupKey(column.group) === groupKey(drag.group));
      if (from >= 0 && from !== drag.index && drag.index >= 0 && drag.index < order.length) order.splice(drag.index, 0, order.splice(from, 1)[0]);
    }
    const offsets = columnOffsets(order.map(column => collapsed[view.columns.indexOf(column)]),
      measurements.pad.start, measurements.columnWidth, measurements.columnGap);
    order.forEach((column, index) => {
      const attached = column.containerEl.parentElement === container, { start, width } = offsets.columns[index];
      column.containerEl.setCssStyles({ top: measurements.pad.top + 'px', bottom: measurements.pad.bottom + 'px', insetInlineStart: start + 'px', width: width + 'px' });
      if (!attached) container.appendChild(column.containerEl);
      if (collapsed[view.columns.indexOf(column)]) {
        column.recycleItems();
        column.innerEl.setChildrenInPlace([]);
      } else if (!attached) {
        column.readViewport();
        column.updateVirtualDisplay();
      }
    });
    container.style.width = Math.max(0, offsets.end - measurements.columnGap + measurements.pad.end) + 'px';
  }
  refresh() {
    for (const view of this.views) {
      if (!view.containerEl.isConnected) this.views.delete(view);
      else view.updateVirtualDisplay();
    }
  }
  destroy() {
    this.restores.reverse().forEach(restore => restore());
    for (const view of this.views) {
      for (const column of view.columns || []) {
        column.containerEl.classList.remove(CLASS);
        column.headerEl?.querySelector(':scope > .bkt-collapse')?.remove();
      }
    }
    this.views.clear();
  }
}
