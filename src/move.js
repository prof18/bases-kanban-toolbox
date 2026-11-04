import { groupKey } from './collapse.js';

// Native Kanban builds a card's context menu through the workspace file menu.
// On mobile the same menu opens when a long press ends without moving. This
// adds "Move to" with the board's other columns and moves the card through
// native moveCardToColumn, which handles properties, folders and undo.
export function cardContext(views, target) {
  const cardEl = target?.closest?.('.bases-kanban-card');
  if (!cardEl) return null;
  for (const view of views) {
    for (const column of view.columns || []) {
      const item = column.items?.find(card => card.el === cardEl);
      if (item?.entry && column.group) return { view, column, entry: item.entry };
    }
  }
  return null;
}
export function columnLabel(column) {
  const heading = column.headerEl?.querySelector?.('.bases-group-heading')?.textContent?.trim();
  return heading || groupKey(column.group) || 'No value';
}
export function moveTargets(context) {
  const { view, column, entry } = context;
  if (typeof view.moveCardToColumn !== 'function' || !view.canMoveCard?.(entry.file)) return [];
  const current = groupKey(column.group);
  return (view.columns || []).filter(item => item.group && groupKey(item.group) !== current)
    .map(item => ({ label: columnLabel(item), key: item.group.key }));
}
export function addMoveItems(menu, context, onError) {
  const targets = moveTargets(context);
  if (!targets.length) return false;
  const { view, entry } = context;
  const move = target => view.moveCardToColumn(entry.file, target.key).catch(error => onError(error, view, entry.file));
  let submenu = null;
  menu.addItem(item => {
    item.setTitle('Move to column').setIcon('lucide-arrow-right-left').setSection('action');
    submenu = typeof item.setSubmenu === 'function' ? item.setSubmenu() : null;
    if (submenu) for (const target of targets) submenu.addItem(sub => sub.setTitle(target.label).onClick(() => move(target)));
    else item.setTitle('Move to ' + targets[0].label).onClick(() => move(targets[0]));
  });
  // Menus without submenus get one entry per column instead.
  if (!submenu) for (const target of targets.slice(1)) {
    menu.addItem(item => item.setTitle('Move to ' + target.label).setIcon('lucide-arrow-right-left').setSection('action').onClick(() => move(target)));
  }
  return true;
}
