/** Resolve bundled examples and opt-in local data without accepting external URLs. */
export interface Dataset { id: string; title: string; file: string; description: string }
export function datasetRequest(search: string, catalog: Dataset[], base = './'): string | null {
  const p = new URLSearchParams(search), requested = p.get('example'), data = p.get('data');
  const example = requested === '1' ? catalog[0]?.id : requested; // Legacy shortcut opens the first listed example.
  if (requested === '1' && !example) throw new Error('Bundled example not found.');
  if (example) {
    const item = catalog.find(d => d.id === example);
    if (!item || !/^[a-zA-Z0-9_-]+\.agent-state\.json$/.test(item.file)) throw new Error('Bundled example not found.');
    return `${base}examples/${item.file}`;
  }
  if (data != null) {
    if (!/^[a-zA-Z0-9_-]+$/.test(data)) throw new Error('Invalid local trajectory name.');
    return `${base}local-data/${data}.json`;
  }
  return p.get('demo') === '1' ? `${base}local-data/demo.thoughtdag.json` : null;
}
