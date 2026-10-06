import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { interfaceKeys } from './i18n-keys.mjs';

// The interface switches between English and Chinese. English text is the key; Chinese lives in a JSON file,
// so component sources stay English-only (test-ui-language) and every key must still have a Chinese entry.
const zh = JSON.parse(readFileSync(new URL('../src/trajectory/i18n.zh.json', import.meta.url), 'utf8'));
const keys = interfaceKeys();
const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

assert.ok(keys.length > 150, `expected the interface keys to be found, got ${keys.length}`);
assert.equal(typeof zh.$name, 'string', 'the Chinese dictionary names its language for the toggle');
const missing = keys.filter(k => typeof zh[k] !== 'string' || !zh[k].trim());
assert.deepEqual(missing, [], 'every interface string has a Chinese entry');
const stale = Object.keys(zh).filter(k => k !== '$name' && !keys.includes(k));
assert.deepEqual(stale, [], 'no Chinese entry outlives its interface string');
const mismatched = keys.filter(k => placeholders(k).join() !== placeholders(zh[k]).join());
assert.deepEqual(mismatched, [], 'a translation keeps the same placeholders as its key');
console.log(`PASS: ${keys.length} interface strings, each with a Chinese entry and matching placeholders`);
