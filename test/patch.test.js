import { test } from 'vitest';
import assert from 'node:assert/strict';
import { patchMethod } from '../src/patch.js';

test('patchMethod calls around with manager, instance, original and args and returns its result', () => {
  class Target { greet(name) { return 'hi ' + name; } }
  const manager = { id: 'm' };
  const calls = [];
  patchMethod(Target.prototype, 'greet', manager, (m, instance, original, args) => {
    calls.push([m, instance, args]);
    return original.apply(instance, args) + '!';
  });
  const target = new Target();
  assert.equal(target.greet('bob'), 'hi bob!');
  assert.deepEqual(calls, [[manager, target, ['bob']]]);
});

test('restore puts the original method back', () => {
  class Target { greet() { return 'hi'; } }
  const original = Target.prototype.greet;
  const restore = patchMethod(Target.prototype, 'greet', {}, () => 'patched');
  assert.equal(new Target().greet(), 'patched');
  restore();
  assert.equal(Target.prototype.greet, original);
});

test('restore is a no-op when another wrapper was installed on top', () => {
  class Target { greet() { return 'hi'; } }
  const restore = patchMethod(Target.prototype, 'greet', {}, () => 'first');
  const outer = function() { return 'outer'; };
  Target.prototype.greet = outer;
  restore();
  assert.equal(Target.prototype.greet, outer);
});
