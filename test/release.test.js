import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MIN_VERSION } from '../src/order.js';

// Vite rewrites new URL(literal, import.meta.url) into a dev-server URL; a variable base avoids that.
const here = import.meta.url;
const read = name => JSON.parse(fs.readFileSync(new URL('../' + name, here), 'utf8'));

test('package, manifest and versions.json agree on the release', () => {
  const manifest = read('manifest.json'), pkg = read('package.json'), versions = read('versions.json');
  assert.equal(pkg.version, manifest.version);
  assert.equal(versions[manifest.version], manifest.minAppVersion);
  assert.equal(manifest.minAppVersion, '1.14.0');
  assert.equal(manifest.minAppVersion, MIN_VERSION);
});

test('manifest meets the community directory rules', () => {
  const manifest = read('manifest.json');
  assert.doesNotMatch(manifest.id, /obsidian/);
  assert.doesNotMatch(manifest.name, /Obsidian/);
  assert.doesNotMatch(manifest.description, /Obsidian/);
  assert.doesNotMatch(manifest.description, /^This plugin/);
  assert.match(manifest.description, /\.$/);
});
