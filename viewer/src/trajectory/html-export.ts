/** Shared by the browser exporter and the build that supplies its offline runtime. */
export interface EmbeddedExport { graph: unknown; language: 'en' | 'zh' }

const DATA_SLOT = '<script id="tracevista-data" type="application/json">null</script>';

export function createExportTemplate(runtime: string, css: string): string {
  // HTML parses closing tags even inside JavaScript strings and CSS comments.
  const script = runtime.replace(/<\/script/gi, '<\\/script');
  const styles = css.replace(/<\/style/gi, '<\\/style');
  return `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>TraceVista</title>
<style id="tracevista-styles">${styles}</style></head>
<body><div id="root"></div>${DATA_SLOT}
<script id="tracevista-runtime">${script}</script></body></html>`;
}

export function createHtmlExport(template: string, graph: unknown, language: EmbeddedExport['language']): string {
  if (!template.includes(DATA_SLOT)) throw new Error('Invalid HTML export template');
  const json = JSON.stringify({ graph, language }).replace(/[<>&\u2028\u2029]/g,
    c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  // A replacement function preserves literal replacement tokens such as $& in raw evidence.
  return template.replace(DATA_SLOT, () => `<script id="tracevista-data" type="application/json">${json}</script>`)
    .replace('<html lang="en">', `<html lang="${language === 'zh' ? 'zh-CN' : 'en'}">`);
}

export function readEmbeddedExport(doc: Pick<Document, 'getElementById'>): EmbeddedExport | null {
  const text = doc.getElementById('tracevista-data')?.textContent;
  if (!text) return null;
  const payload = JSON.parse(text) as EmbeddedExport | null;
  if (payload === null) return null;
  if (!payload.graph || !['en', 'zh'].includes(payload.language)) throw new Error('Invalid embedded trajectory');
  return payload;
}

export function htmlExportFilename(title: string): string {
  const name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 120);
  return `${name || 'tracevista'}.html`;
}
