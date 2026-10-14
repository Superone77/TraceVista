import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const code = stripTypeScriptTypes(readFileSync(new URL('../src/trajectory/panelSizing.ts', import.meta.url), 'utf8'));
const { chatBounds, clampChatWidth } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const desktop = chatBounds(1680, false, true);
assert.deepEqual(desktop, { min: 320, max: 1160 });
assert.equal(clampChatWidth(2000, desktop, 448), 1160, 'Wide chat leaves room for Story and Map');
assert.equal(clampChatWidth(100, desktop, 448), 320, 'Chat remains readable at its minimum');
assert.equal(chatBounds(1680, false, false).max, 1440, 'Hidden Story releases its space');
assert.deepEqual(chatBounds(800, true, true), { min: 320, max: 776 }, 'Floating chat is bounded by the screen rather than the map');
assert.deepEqual(chatBounds(300, true, true), { min: 276, max: 276 }, 'A narrow screen takes priority over the preferred minimum');
assert.equal(clampChatWidth(NaN, desktop, 448), 448, 'Invalid saved width restores the default');
assert.equal(clampChatWidth(900, chatBounds(800, false, true), 448), 280, 'Shrinking the workspace clamps oversized saved widths');
assert.equal(clampChatWidth(560, desktop, 448), 560, 'Normal drag widths are retained exactly');
console.log('PASS: chat sizing preserves adjacent panels and adapts to floating and narrow layouts');
