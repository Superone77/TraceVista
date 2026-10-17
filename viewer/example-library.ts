import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Dataset } from './src/trajectory/dataset';

export interface ExampleLock {
  version: 1;
  repository: string;
  revision: string;
  files: Record<string, string>;
}

export function sha256(contents: Buffer | string): string {
  return createHash('sha256').update(contents).digest('hex');
}

/** Load only the pinned, public assets. Local imports never enter this map. */
export function loadExampleLibrary(repoRoot: string, libraryPath?: string) {
  const lockBytes = readFileSync(resolve(repoRoot, 'examples.lock.json'));
  const lock = JSON.parse(lockBytes.toString()) as ExampleLock;
  if (lock.version !== 1 || !/^[a-f0-9]{40}$/.test(lock.revision) || !lock.files
    || !Object.keys(lock.files).length) throw new Error('Invalid examples.lock.json.');
  if (libraryPath !== undefined && !libraryPath.trim()) throw new Error('TRACEVISTA_EXAMPLES_DIR must name an example library directory.');
  const requestedPath = libraryPath ?? resolve(repoRoot, '../TraceVista-examples');
  let libraryRoot: string;
  try { libraryRoot = realpathSync(requestedPath); }
  catch { throw new Error(`Example library not found at ${requestedPath}. Set TRACEVISTA_EXAMPLES_DIR to the pinned example repository. Use pnpm dev or pnpm build for the standalone viewer.`); }
  const assets = new Map<string, Buffer>();
  for (const [path, digest] of Object.entries(lock.files)) {
    if (!/^(examples\/[a-zA-Z0-9_.-]+\.json|example-thumbnails\/[a-zA-Z0-9_.-]+\.(png|webp|jpg)|THIRD_PARTY_NOTICES\.md|LICENSES\/[a-zA-Z0-9_.-]+\.txt)$/.test(path)
      || !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`Invalid pinned asset: ${path}`);
    let realPath: string;
    try { realPath = realpathSync(resolve(libraryRoot, path)); }
    catch { throw new Error(`Missing pinned example asset: ${path}`); }
    const withinLibrary = relative(libraryRoot, realPath);
    if (withinLibrary.startsWith('..') || isAbsolute(withinLibrary)) throw new Error(`Example asset escapes library: ${path}`);
    const contents = readFileSync(realPath);
    if (sha256(contents) !== digest) throw new Error(`Example asset differs from examples.lock.json: ${path}`);
    const outputPath = path === 'THIRD_PARTY_NOTICES.md' || path.startsWith('LICENSES/') ? `examples/${path}` : path;
    assets.set(outputPath, contents);
  }
  const index = assets.get('examples/index.json');
  if (!index) throw new Error('Pinned example catalog is missing.');
  const catalog = JSON.parse(index.toString()) as Dataset[];
  if (!Array.isArray(catalog) || !catalog.length) throw new Error('The website example catalog must not be empty.');
  const ids = new Set<string>();
  for (const entry of catalog) {
    if (!/^[a-zA-Z0-9_-]+$/.test(entry.id) || ids.has(entry.id)
      || typeof entry.title !== 'string' || !entry.title.trim()
      || !/^[a-zA-Z0-9_-]+\.agent-state\.json$/.test(entry.file)) throw new Error('Invalid or duplicate example catalog entry.');
    ids.add(entry.id);
    const data = assets.get(`examples/${entry.file}`);
    if (!data || JSON.parse(data.toString()).format !== 'coding-agent-state-trajectory') throw new Error(`Missing or invalid trajectory: ${entry.id}`);
    const thumbnail = entry.thumbnail ?? `${entry.id}.png`;
    if (!/^[a-zA-Z0-9_.-]+\.(png|webp|jpg)$/.test(thumbnail) || !assets.has(`example-thumbnails/${thumbnail}`)) throw new Error(`Missing thumbnail: ${entry.id}`);
    if (entry.thumbnailCrop && (entry.thumbnailCrop.length !== 4 || !entry.thumbnailCrop.every(Number.isFinite)
      || entry.thumbnailCrop.some(n => n < 0) || entry.thumbnailCrop[2] <= 0 || entry.thumbnailCrop[3] <= 0)) throw new Error(`Invalid thumbnail crop: ${entry.id}`);
  }
  return { catalog, assets, lock, lockHash: sha256(lockBytes) };
}
