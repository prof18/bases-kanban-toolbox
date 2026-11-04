// Wraps prototype[name] so around(manager, instance, original, args) runs instead.
// The returned restore only undoes this wrapper if nothing wrapped it since.
export function patchMethod(prototype, name, manager, around) {
  const original = prototype[name];
  const wrapped = function(...args) { return around(manager, this, original, args); };
  prototype[name] = wrapped;
  return () => { if (prototype[name] === wrapped) prototype[name] = original; };
}
