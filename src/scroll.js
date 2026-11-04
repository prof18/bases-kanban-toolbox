import { groupKey } from './collapse.js';
import { patchMethod } from './patch.js';

// Native Kanban keeps the horizontal offset as lastScroll = { left: fraction of
// the board width }, rewrites it on every layout pass, and applies
// pendingScroll (from history's ephemeral state) on the next pass, even
// before any column exists. Each column also scrolls vertically, which native
// never saves, and a column loses its offset whenever the board detaches or
// moves it. This adds a columns map next to left, keyed by group, updated only
// by real scroll events and applied again after every visible layout pass.
export function cleanColumns(columns) {
  const result = {};
  if (!columns || typeof columns !== 'object') return result;
  for (const [key, top] of Object.entries(columns)) if (Number.isFinite(top) && top > 0) result[key] = top;
  return result;
}

export class ScrollMemory {
  constructor() {
    this.restores = []; this.views = new Set(); this.listeners = new WeakMap();
    this.hidden = new WeakSet(); this.internal = new WeakSet(); this.lazyLeft = new WeakMap(); this.columns = new WeakMap(); this.saved = new WeakMap();
  }
  install(view) {
    if (this.viewPrototype) return;
    const prototype = Object.getPrototypeOf(view), original = prototype.updateVirtualDisplay;
    if (typeof original !== 'function' || !('pendingScroll' in view) || !('lastScroll' in view)) return;
    this.viewPrototype = prototype;
    this.restores.push(patchMethod(prototype, 'updateVirtualDisplay', this, (manager, instance, method, args) => {
      const pending = manager.before(instance);
      const result = method.apply(instance, args);
      manager.after(instance, pending);
      return result;
    }));
  }
  watch(view) {
    if (this.listeners.has(view) || !view.scrollEl?.addEventListener) return;
    // Scroll does not bubble, but a capturing listener sees the columns too.
    const listener = event => this.record(view, event.target);
    view.scrollEl.addEventListener('scroll', listener, { capture: true, passive: true });
    this.listeners.set(view, listener);
    this.views.add(view);
  }
  shown(view) { return Boolean(view.containerEl?.isShown?.()); }
  before(view) {
    // Hiding a leaf can drop its offsets, so showing it again restores them.
    if (this.hidden.has(view) && this.shown(view)) {
      this.hidden.delete(view);
      if (!view.pendingScroll && this.saved.has(view)) view.pendingScroll = { ...this.saved.get(view) };
    }
    return view.pendingScroll;
  }
  after(view, pending) {
    this.watch(view);
    if (!this.shown(view)) {
      this.hidden.add(view);
      // A pass while hidden reads scrollLeft as 0; keep what history should save.
      if (this.saved.has(view)) view.lastScroll = { ...this.saved.get(view) };
      return;
    }
    if (pending && typeof pending === 'object' && view.pendingScroll !== pending && !this.internal.has(pending)) {
      // Native applies left on the first pass, even to a board with no columns yet.
      const left = Number(pending.left);
      if ((!view.data || !view.columns?.length) && Number.isFinite(left)) this.lazyLeft.set(view, left);
      this.columns.set(view, cleanColumns(pending.columns));
    }
    if (!view.pendingScroll && view.data && view.columns?.length) {
      if (this.lazyLeft.has(view)) {
        // Let native apply left again now that it knows the board width. The
        // nested pass restores the columns and publishes the state.
        const state = { ...view.lastScroll, left: this.lazyLeft.get(view) };
        this.lazyLeft.delete(view);
        this.internal.add(state);
        view.pendingScroll = state;
        view.updateVirtualDisplay();
        return;
      }
      this.restore(view);
    }
    this.publish(view);
  }
  restore(view) {
    const columns = this.columns.get(view);
    if (!columns) return;
    const known = new Set();
    for (const column of view.columns) {
      if (!column.group) continue;
      const key = groupKey(column.group), element = column.contentEl;
      known.add(key);
      // Columns outside the viewport restore when they attach.
      if (key in columns && element?.isConnected && Math.abs(element.scrollTop - columns[key]) >= 1) element.scrollTop = columns[key];
    }
    for (const key of Object.keys(columns)) if (!known.has(key)) delete columns[key];
  }
  publish(view) {
    view.lastScroll = { ...view.lastScroll, columns: { ...(this.columns.get(view) || {}) } };
    this.saved.set(view, { ...view.lastScroll });
  }
  record(view, target) {
    if (!this.shown(view) || view.pendingScroll) return;
    // Only the column that scrolled; a detached or moved column reads 0 without being scrolled.
    const column = view.columns?.find(item => item.contentEl === target);
    if (!column?.group || !target.isConnected) return;
    const columns = { ...(this.columns.get(view) || {}) }, key = groupKey(column.group);
    if (target.scrollTop > 0) columns[key] = target.scrollTop; else delete columns[key];
    this.columns.set(view, columns);
    this.publish(view);
  }
  destroy() {
    this.restores.reverse().forEach(restore => restore());
    for (const view of this.views) view.scrollEl?.removeEventListener('scroll', this.listeners.get(view), { capture: true });
    this.views.clear();
  }
}
