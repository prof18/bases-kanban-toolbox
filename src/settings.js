// Settings model. No imports: the vault migration runs this file directly with Node.
export const FEATURE_KEYS = ['compactCards', 'fitColumns', 'manualOrder', 'cardPopup', 'moveToColumn', 'collapsibleColumns', 'scrollRestore'];
export const DEFAULT_ORDER_PROPERTY = 'Position';

const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const propertyName = value => typeof value === 'string' ? value.trim().replace(/^note\./, '') : '';
const propertyList = items => [...new Set(items.filter(item => typeof item === 'string').map(propertyName).filter(Boolean))];

// Always returns fresh objects and arrays, so callers can mutate the result.
export function normalizeSettings(raw) {
  const data = plain(raw) ? raw : {};
  const features = plain(data.features) ? data.features : {};
  const collapsed = {};
  if (plain(data.collapsed)) {
    for (const [key, groups] of Object.entries(data.collapsed)) {
      if (Array.isArray(groups) && groups.every(group => typeof group === 'string')) collapsed[key] = [...groups];
    }
  }
  return {
    features: Object.fromEntries(FEATURE_KEYS.map(key => [key, typeof features[key] === 'boolean' ? features[key] : true])),
    orderProperty: propertyName(data.orderProperty) || DEFAULT_ORDER_PROPERTY,
    autoSort: typeof data.autoSort === 'boolean' ? data.autoSort : true,
    hideWhenEmpty: Array.isArray(data.hideWhenEmpty) ? propertyList(data.hideWhenEmpty) : [],
    collapsed,
  };
}

const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const DEFAULT_SETTINGS = freeze(normalizeSettings(null));

export function parsePropertyList(text) { return propertyList(String(text ?? '').split(',')); }
export function formatPropertyList(list) { return list.join(', '); }
