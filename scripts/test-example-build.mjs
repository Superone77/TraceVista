import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadExampleLibrary, sha256 } from '../viewer/example-library.ts';

const temp = mkdtempSync(join(tmpdir(), 'tracevista-example-build-'));
try {
  const root = join(temp, 'viewer');
  const library = join(temp, 'library');
  mkdirSync(root);
  mkdirSync(join(library, 'examples'), { recursive: true });
  mkdirSync(join(library, 'example-thumbnails'));
  const entry = { id: 'tiny', title: 'Synthetic test', file: 'tiny.agent-state.json', thumbnailCrop: [0, 0, 1280, 720] };
  const assets = {
    'examples/index.json': JSON.stringify([entry]),
    'examples/tiny.agent-state.json': JSON.stringify({ format: 'coding-agent-state-trajectory' }),
    'example-thumbnails/tiny.png': 'fixture image',
    'THIRD_PARTY_NOTICES.md': 'Synthetic test data',
    'LICENSE': 'Synthetic library license',
  };
  const lock = { version: 1, repository: 'test-library', revision: 'a'.repeat(40), files: {} };
  const pin = () => {
    for (const [path, contents] of Object.entries(assets)) {
      writeFileSync(join(library, path), contents);
      lock.files[path] = sha256(contents);
    }
    writeFileSync(join(root, 'examples.lock.json'), JSON.stringify(lock));
  };
  pin();
  writeFileSync(join(library, 'not-for-publishing.json'), 'unlisted local data');
  const loaded = loadExampleLibrary(root, library);
  assert.equal(loaded.catalog.length, 1);
  assert.equal(loaded.assets.size, 5);
  assert.ok(loaded.assets.has('examples/THIRD_PARTY_NOTICES.md'));
  assert.equal(loaded.assets.get('examples/LICENSE').toString(), assets.LICENSE);
  assert.ok(!loaded.assets.has('not-for-publishing.json'));
  assert.equal(loaded.lockHash.length, 64);
  assert.throws(() => loadExampleLibrary(root, ''), /must name/);
  assert.throws(() => loadExampleLibrary(root, '   '), /must name/);
  assert.throws(() => loadExampleLibrary(root, join(temp, 'missing')), /not found/);
  rmSync(join(library, 'LICENSE'));
  assert.throws(() => loadExampleLibrary(root, library), /Missing pinned/);
  pin();
  writeFileSync(join(library, 'LICENSE'), 'different terms');
  assert.throws(() => loadExampleLibrary(root, library), /differs/);
  pin();
  writeFileSync(join(library, entry.file), 'not in the catalog directory');
  writeFileSync(join(library, 'examples', entry.file), 'changed evidence');
  assert.throws(() => loadExampleLibrary(root, library), /differs/);
  pin();
  rmSync(join(library, 'example-thumbnails/tiny.png'));
  assert.throws(() => loadExampleLibrary(root, library), /Missing pinned/);
  pin();
  const outside = join(temp, 'outside.png');
  writeFileSync(outside, assets['example-thumbnails/tiny.png']);
  rmSync(join(library, 'example-thumbnails/tiny.png'));
  symlinkSync(outside, join(library, 'example-thumbnails/tiny.png'));
  assert.throws(() => loadExampleLibrary(root, library), /escapes/);
  rmSync(join(library, 'example-thumbnails/tiny.png'));
  assets['examples/index.json'] = JSON.stringify([entry, entry]);
  pin();
  assert.throws(() => loadExampleLibrary(root, library), /duplicate/);
  assets['examples/index.json'] = JSON.stringify([{ ...entry, thumbnailCrop: [0, 0, -1, 720] }]);
  pin();
  assert.throws(() => loadExampleLibrary(root, library), /crop/);
  lock.files['../private.json'] = 'a'.repeat(64);
  pin();
  assert.throws(() => loadExampleLibrary(root, library), /Invalid pinned asset/);
  console.log('PASS: example pinning, isolation, missing data, changed evidence, symlinks and catalog validation');
} finally { rmSync(temp, { recursive: true, force: true }); }
