// Based on the guarded ordering approach in Bases Kanban Companion (MIT),
// copyright 2026 wjsyuwls. This version has no project-routing dependency.
// First release with the native Kanban layout. Internals were reviewed on 1.14.4–1.15.0;
// every hook checks the shapes it relies on, so other releases degrade to native behaviour.
export const MIN_VERSION = '1.14.0';
const MAX_CARDS = 500;
export function supported(version) {
  const parts = value => String(value).split('.').map(part => parseInt(part, 10) || 0);
  const have = parts(version), need = parts(MIN_VERSION);
  for (let i = 0; i < need.length; i++) if ((have[i] || 0) !== need[i]) return (have[i] || 0) > need[i];
  return true;
}
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const encoded = value => JSON.stringify(value);

export function reorder(files, moved, slot) {
  const source = files.indexOf(moved);
  if (source < 0 || new Set(files).size !== files.length || !Number.isInteger(slot) || slot < 0 || slot > files.length) {
    throw new Error('Invalid insertion position.');
  }
  const result = files.filter(file => file !== moved);
  result.splice(slot > source ? slot - 1 : slot, 0, moved);
  return result;
}

export function dropSlot(y, top, height, gap, count) {
  if (![y, top, height, gap].every(Number.isFinite) || height <= 0 || gap < 0) throw new Error('Unsupported card geometry.');
  return Math.max(0, Math.min(count, Math.floor((y - top + height / 2) / (height + gap))));
}

// The order property must be first and ascending. Other sorts cannot silently turn into editable ranks.
export function sortedBy(sort, property) {
  const ids = [property, 'note.' + property];
  return Array.isArray(sort) && ids.includes(sort[0]?.property) && sort[0].direction === 'ASC'
    && !sort.slice(1).some(row => ids.includes(row.property));
}

// allowUnsorted accepts a board that is not sorted by the property, if the board can be sorted by it afterwards.
export function contextFor(app, version, drag, target, property, { allowUnsorted = false } = {}) {
  if (!supported(version) || drag?.type !== 'kanban-card') return null;
  const view = drag.view;
  if (!view || view.type !== 'kanban' || view.app !== app || view.isReadOnly || !Array.isArray(view.columns)) return null;
  const config = view.config;
  const groupId = config?.groupBy?.property;
  if (typeof groupId !== 'string' || !(groupId === 'file.folder' || groupId.startsWith('note.') || !groupId.includes('.'))) return null;
  const groupProperty = groupId === 'file.folder' ? null : groupId.replace(/^note\./, '');
  if (groupProperty === property) return null;
  if (typeof config.getLimit !== 'function' || config.getLimit() !== 0 || typeof config.getSort !== 'function') return null;
  if (typeof view.queryController?.getSearchQuery !== 'function' || view.queryController.getSearchQuery()?.trim()) return null;
  const sorted = sortedBy(config.getSort(), property);
  if (!sorted && (!allowUnsorted || typeof config.setSortProperty !== 'function')) return null;
  const element = target?.closest?.('.bases-kanban-column');
  const column = view.columns.find(item => item.containerEl === element);
  if (!column?.innerEl || !column.group || column.group !== drag.sourceGroup || !Array.isArray(column.group.entries)) return null;
  const files = column.group.entries.map(entry => entry.file);
  if (!files.length || files.length > MAX_CARDS || !files.includes(drag.entry?.file)) return null;
  if (!Number.isFinite(view.measurements?.cardHeight) || !Number.isFinite(view.measurements.cardGap)) return null;
  return { view, column, files, moved: drag.entry.file, groupProperty, sorted };
}

export function planOrder(files, moved, slot, property, groupProperty, metadata) {
  if (!files.length || files.length > MAX_CARDS) throw new Error('Unsupported column size.');
  const records = files.map(file => {
    const fm = metadata(file) || {};
    if (file.extension !== 'md') throw new Error('Only note cards can be reordered.');
    const before = fm[property];
    if (own(fm, property) && (typeof before !== 'number' || !Number.isFinite(before))) throw new Error(property + ' must be a number.');
    const groupValue = groupProperty ? fm[groupProperty] : file.parent.path;
    if (groupValue !== undefined && groupValue !== null && !['string', 'number', 'boolean'].includes(typeof groupValue)) {
      throw new Error('Reordering requires a single-valued grouping property.');
    }
    return { file, path: file.path, folder: file.parent.path, before, had: own(fm, property), groupHad: groupProperty ? own(fm, groupProperty) : true, group: encoded(groupValue) };
  });
  if (new Set(records.map(record => record.path)).size !== files.length) throw new Error('Duplicate cards.');
  if (records.some(record => record.group !== records[0].group || record.groupHad !== records[0].groupHad)) throw new Error('The column changed; retry the drag.');
  const ordered = reorder(files, moved, slot);
  const changes = ordered.map((file, index) => ({ ...records.find(record => record.file === file), after: index + 1, afterHad: true }))
    .filter(record => !record.had || record.before !== record.after);
  return changes.length ? { property, groupProperty, records, changes } : null;
}

function matches(record, fm, plan, io) {
  const group = plan.groupProperty ? fm[plan.groupProperty] : record.file.parent.path;
  return io.currentFile(record.file) && record.file.path === record.path && record.file.parent.path === record.folder
    && (plan.groupProperty ? own(fm, plan.groupProperty) : true) === record.groupHad && encoded(group) === record.group
    && own(fm, plan.property) === record.had && fm[plan.property] === record.before;
}

function assign(fm, property, value, had) {
  if (had) fm[property] = value;
  else delete fm[property];
}

export async function applyOrder(plan, io, allowed, beforeWrites = () => true) {
  const written = [];
  try {
    for (const record of plan.records) {
      if (!allowed() || !matches(record, await io.read(record.file), plan, io)) throw new Error('Cards or view changed; reorder cancelled.');
    }
    if (!allowed() || !beforeWrites()) throw new Error('Displayed order changed; reorder cancelled.');
    for (const record of plan.changes) {
      if (!allowed()) throw new Error('View changed while saving.');
      await io.process(record.file, fm => {
        if (!allowed() || !matches(record, fm, plan, io)) throw new Error('A card changed while saving.');
        assign(fm, plan.property, record.after, record.afterHad);
      });
      written.push(record);
    }
    if (!allowed()) throw new Error('View changed while saving.');
  } catch (error) {
    const failed = [];
    for (const record of written.reverse()) {
      try {
        await io.process(record.file, fm => {
          if (!matches({ ...record, before: record.after, had: record.afterHad }, fm, plan, io)) throw new Error('Concurrent edit');
          assign(fm, plan.property, record.before, record.had);
        });
      } catch { failed.push(record.path); }
    }
    if (failed.length) throw new Error(error.message + ' Recovery incomplete: ' + failed.join(', '));
    throw error;
  }
  const reverse = plan.changes.map(record => ({ ...record, before: record.after, had: record.afterHad, after: record.before, afterHad: record.had }));
  return { ...plan, records: reverse, changes: reverse };
}
