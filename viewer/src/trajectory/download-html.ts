import { createExportTemplate, createHtmlExport, htmlExportFilename } from './html-export';
import type { Graph } from './model';
import type { Lang } from './i18n';

export async function downloadHtml(graph: Graph, language: Lang, base: string): Promise<void> {
  const runtime = document.getElementById('tracevista-runtime');
  const styles = document.getElementById('tracevista-styles');
  let template: string;
  if (runtime && styles) {
    // An exported page can export a newly imported trace again, entirely offline.
    template = createExportTemplate(runtime.textContent ?? '', styles.textContent ?? '');
  } else {
    const response = await fetch(`${base}tracevista-export.html`);
    if (!response.ok) throw new Error('Could not load HTML export template');
    template = await response.text();
  }
  const html = createHtmlExport(template, graph, language);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: htmlExportFilename(graph.title) });
  document.body.append(link);
  link.click();
  link.remove();
  // Let the browser consume the download before releasing its backing Blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
