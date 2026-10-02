/** Resolve bundled examples and opt-in local data without accepting external URLs. */
export interface Dataset { id: string; title: string; file: string; description: string }
export function datasetRequest(search: string, catalog: Dataset[], base = './'): string | null {
  const p = new URLSearchParams(search), requested = p.get('example'), data = p.get('data');
  const example = requested === '1' ? 'pi-infra-r1' : requested; // Legacy demo link opens the bundled Pi example.
  if (example) {
    const item = catalog.find(d => d.id === example);
    if (!item || !/^[a-zA-Z0-9_-]+\.agent-state\.json$/.test(item.file)) throw new Error('未找到这个内置示例。');
    return `${base}examples/${item.file}`;
  }
  if (data != null) {
    if (!/^[a-zA-Z0-9_-]+$/.test(data)) throw new Error('本地轨迹名称无效。');
    return `${base}local-data/${data}.json`;
  }
  return p.get('demo') === '1' ? `${base}local-data/demo.thoughtdag.json` : null;
}
