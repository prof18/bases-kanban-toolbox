import { patchMethod } from './patch.js';

function emptyValue(entry, prop) {
  const value = entry.getValue(prop);
  // Dates and other values without data are empty only when falsy, as a missing value is.
  if (value != null && !('data' in value)) return typeof value.isTruthy === 'function' && !value.isTruthy();
  return value == null || value.data == null || value.data === '' || (Array.isArray(value.data) && value.data.length === 0);
}
export function rowsFor(entries, properties, measurements, titleHeightFor, hideWhenEmpty = []) {
  let top = 0;
  const rows = entries.map(entry => {
    const hidden = properties.map((prop, index) => index > 0 && hideWhenEmpty.some(name => prop === name || prop === 'note.' + name) && emptyValue(entry, prop));
    const measured = titleHeightFor?.(entry, properties[0]);
    const titleHeight = Math.max(measurements.titleHeight, Number.isFinite(measured) && measured > 0 ? measured : measurements.titleHeight);
    const height = measurements.cardHeight - hidden.filter(Boolean).length * (measurements.propHeight + measurements.propGap)
      + titleHeight - measurements.titleHeight;
    if (!Number.isFinite(height) || height <= 0) throw new Error('Unsupported compact card geometry.');
    const row = { entry, top, height, hidden, titleHeight };
    top += height + measurements.cardGap;
    return row;
  });
  return { rows, height: rows.length ? top - measurements.cardGap : 0 };
}
export function slotForRows(y, rows) {
  if (!Number.isFinite(y)) throw new Error('Unsupported drop coordinate.');
  const index = rows.findIndex(row => y < row.top + row.height / 2);
  return index < 0 ? rows.length : index;
}
export function boundaryForRows(slot, layout, gap) {
  return slot === layout.rows.length ? layout.height + gap / 2 : layout.rows[slot].top - gap / 2;
}
export function compactAllowed(view) {
  return !view.pendingMove && !(view.cardDrag && !view.cardDrag.col?.group?.entries.some(entry => entry.file === view.cardDrag.entry.file))
    && Boolean(view.data?.properties?.length);
}

// Obsidian 1.14.4 uses absolute positions and virtualizes cards. Keep that
// lifecycle, but calculate each row from the properties it actually displays.
export class CompactLayout {
  // options() is read on every pass, so settings changes apply without rebuilding.
  constructor(options = () => ({ compactCards: true, fitColumns: true, hideWhenEmpty: [] })) {
    this.options = options; this.restores = []; this.views = new Set(); this.layouts = new WeakMap(); this.titleMeasurements = new WeakMap();
  }
  allowed(view) { return this.options().compactCards && compactAllowed(view); }
  titleMeasurer(column) {
    const view = column.view;
    const line = column.items[0]?.props[0]?.lineEl || view.columns.find(c => c.items[0]?.props[0]?.lineEl)?.items[0].props[0].lineEl;
    const doc = line?.ownerDocument, win = doc?.defaultView;
    const width = column.innerEl.clientWidth - (view.measurements.cardPad.start || 0) - (view.measurements.cardPad.end || 0);
    if (!win || !Number.isFinite(width) || width <= 0) return null;
    line.closest('.bases-kanban-card')?.classList.add('bkt-wrap');
    const style = win.getComputedStyle(line);
    // styles.css can apply after the first layout pass, which nothing repeats.
    // Measuring the native one-line style then would clip every wrapped title.
    if (style.whiteSpace !== 'normal') { this.retryWhenStyled(win); return null; }
    this.styleRetries = 0;
    const signature = [width, style.font, style.lineHeight, style.letterSpacing, style.wordSpacing, style.padding, style.borderWidth, style.boxSizing].join('|');
    let cached = this.titleMeasurements.get(column);
    if (!cached || cached.signature !== signature) {
      const element = doc.createElement('div');
      Object.assign(element.style, {
        position: 'fixed', visibility: 'hidden', pointerEvents: 'none', top: '0', left: '0',
        width: width + 'px', boxSizing: style.boxSizing, font: style.font,
        lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing,
        padding: style.padding, borderStyle: 'solid', borderWidth: style.borderWidth,
        whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'normal', margin: '0',
      });
      cached = { signature, element, heights: new Map() };
      this.titleMeasurements.set(column, cached);
    }
    return {
      measure: (entry, property) => {
        const value = entry.getValue(property);
        const text = value == null ? '' : typeof value.data === 'string' || typeof value.data === 'number' ? String(value.data) : value.toString();
        const key = property + '\n' + text;
        if (!cached.heights.has(key)) {
          if (!cached.element.isConnected) column.innerEl.appendChild(cached.element);
          cached.element.textContent = text;
          cached.heights.set(key, Math.ceil(cached.element.getBoundingClientRect().height));
        }
        return cached.heights.get(key);
      },
      detach: () => cached.element.remove(),
    };
  }
  retryWhenStyled(win) {
    if (this.styleRetryQueued || (this.styleRetries || 0) >= 30 || typeof win.requestAnimationFrame !== 'function') return;
    this.styleRetryQueued = true;
    this.styleRetries = (this.styleRetries || 0) + 1;
    win.requestAnimationFrame(() => { this.styleRetryQueued = false; this.refresh(); });
  }
  restoreCards(view, items) {
    for (const item of items) {
      item.el.classList?.remove('bkt-wrap');
      item.props.forEach((prop, index) => {
        prop.el.style.removeProperty('display');
        prop.el.style.height = (index === 0 ? view.measurements.titleHeight : view.measurements.propHeight) + 'px';
      });
    }
  }
  install(view) {
    if (this.viewPrototype) return;
    const prototype = Object.getPrototypeOf(view), original = prototype.updateVirtualDisplay;
    if (typeof original !== 'function') return;
    this.viewPrototype = prototype;
    this.restores.push(patchMethod(prototype, 'updateVirtualDisplay', this, (manager, view, method, args) => {
      manager.views.add(view);
      const result = method.apply(view, args);
      manager.installColumns(view);
      // Columns end below their last card instead of filling the board height.
      const pad = view.measurements?.pad;
      if (manager.options().fitColumns) {
        view.containerEl.classList.add('bkt-fit');
        if (pad) view.containerEl.style.setProperty('--bkt-pad-block', (pad.top || 0) + (pad.bottom || 0) + 'px');
      } else {
        view.containerEl.classList.remove('bkt-fit');
        view.containerEl.style.removeProperty('--bkt-pad-block');
      }
      if (manager.allowed(view) && view.containerEl.isShown()) {
        for (const column of view.columns) if (column.containerEl.isConnected) {
          column.readViewport();
          column.updateVirtualDisplay();
        }
        // The native parent also reserves a uniform height for embedded Bases.
        if (view.scrollEl.matchParent('.block-language-base,.bases-embed')) {
          const height = Math.max(0, ...view.columns.map(column => manager.forColumn(column)?.height ?? rowsFor(column.group.entries, view.data.properties, view.measurements, undefined, manager.options().hideWhenEmpty).height));
          view.containerEl.style.height = view.measurements.pad.top + view.measurements.columnHeight + height + view.measurements.pad.bottom + 'px';
        }
      }
      return result;
    }));
  }
  installColumns(view) {
    if (this.columnPrototype || !view.columns?.length) return;
    const prototype = Object.getPrototypeOf(view.columns[0]);
    if (typeof prototype.updateVirtualDisplay !== 'function') return;
    this.columnPrototype = prototype;
    this.restores.push(patchMethod(prototype, 'updateVirtualDisplay', this, (manager, column, method, args) => {
      if (!manager.allowed(column.view) || !column.viewport || !column.group || !column.view.measurements.cardHeight) {
        manager.layouts.delete(column);
        manager.restoreCards(column.view, [...column.items, ...column.view.unusedItems]);
        return method.apply(column, args);
      }
      let Card = column.items[0]?.constructor || column.view.unusedItems[0]?.constructor;
      if (!Card) {
        method.apply(column, args);
        Card = column.items[0]?.constructor || column.view.unusedItems[0]?.constructor;
      }
      if (!Card) return;
      manager.views.add(column.view);
      const view = column.view, measurements = view.measurements;
      const measurer = manager.titleMeasurer(column);
      let layout;
      try { layout = rowsFor(column.group.entries, view.data.properties, measurements, measurer?.measure, manager.options().hideWhenEmpty); }
      finally { measurer?.detach(); }
      manager.layouts.set(column, layout);
      column.innerEl.style.height = layout.height + 'px';
      const available = column.items.slice(), next = [], elements = [];
      for (const row of layout.rows) {
        if (row.top > column.viewport.bottom || row.top + row.height < column.viewport.top) continue;
        const index = available.findIndex(item => item.entry?.file === row.entry.file);
        const item = index >= 0 ? available.splice(index, 1)[0] : view.unusedItems.pop() || new Card(view);
        item.render(row.entry, view.data.properties, column);
        item.el.classList?.add('bkt-wrap');
        let top = (view.imageProp ? measurements.coverHeight : 0) + measurements.cardPad.top;
        item.props.forEach((prop, index) => {
          prop.el.style.display = row.hidden[index] ? 'none' : '';
          if (row.hidden[index]) return;
          prop.el.style.top = top + 'px';
          prop.el.style.height = (index === 0 ? row.titleHeight : measurements.propHeight) + 'px';
          top += (index === 0 ? row.titleHeight : measurements.propHeight) + measurements.propGap;
        });
        item.el.setCssStyles({ top: row.top + 'px', insetInlineStart: '0', insetInlineEnd: '0', minHeight: row.height + 'px' });
        next.push(item);
        elements.push(item.el);
      }
      view.unusedItems.push(...available);
      column.items = next;
      column.innerEl.setChildrenInPlace(elements);
      if (view.unusedItems.length > 20) view.unusedItems.length = 20;
    }));
  }
  forColumn(column) {
    const layout = this.layouts.get(column);
    return layout && this.allowed(column.view) && layout.rows.length === column.group.entries.length
      && layout.rows.every((row, index) => row.entry.file === column.group.entries[index].file) ? layout : null;
  }
  refresh() {
    this.titleMeasurements = new WeakMap();
    for (const view of this.views) {
      if (!view.containerEl.isConnected) this.views.delete(view);
      else view.updateVirtualDisplay();
    }
  }
  destroy() {
    this.restores.reverse().forEach(restore => restore());
    for (const view of this.views) {
      view.containerEl.classList.remove('bkt-fit', 'bkt-dragging');
      this.restoreCards(view, [...view.columns.flatMap(column => column.items), ...view.unusedItems]);
      if (view.containerEl.isConnected) view.updateVirtualDisplay();
    }
    this.views.clear();
  }
}
