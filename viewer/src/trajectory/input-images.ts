import type { RawEvent } from './model';
/** Read explicit inline attachment objects without interpreting prose, paths or remote URLs. */
export type InputPart = { kind: 'text'; text: string } | { kind: 'image'; src: string; raw: string };

function embeddedImage(value: Record<string, unknown>): string | null {
  let src: unknown;
  if (value.type === 'input_image' || value.type === 'image_url') {
    src = typeof value.image_url === 'string' ? value.image_url : (value.image_url as { url?: unknown } | null)?.url;
  } else if (value.type === 'image') {
    const source = value.source as { type?: unknown; media_type?: unknown; data?: unknown } | undefined;
    if (source?.type === 'base64' && typeof source.media_type === 'string' && typeof source.data === 'string') {
      src = `data:${source.media_type};base64,${source.data}`;
    } else if (typeof value.mimeType === 'string' && typeof value.data === 'string') {
      src = `data:${value.mimeType};base64,${value.data}`;
    }
  }
  // Keep imports offline. SVG/HTML and external or local file URLs remain literal evidence.
  return typeof src === 'string' && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(src) ? src : null;
}

function objectEnd(text: string, start: number): number {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

/** Preserve exact source slices, order and duplicate attachments; never rewrite the export. */
export function inputImageParts(text: string): InputPart[] {
  const parts: InputPart[] = [];
  // Accept any first member (including escaped keys). Parse the complete object
  // before checking attachment fields by name; JSON member order is irrelevant.
  const starts = /\{\s*"(?:\\.|[^"\\])*"\s*:/g;
  let cursor = 0, match: RegExpExecArray | null;
  while ((match = starts.exec(text))) {
    const start = match.index, end = objectEnd(text, start);
    if (end < 0) continue;
    const raw = text.slice(start, end);
    let src: string | null = null;
    try { src = embeddedImage(JSON.parse(raw)); } catch { /* Malformed source stays visible verbatim. */ }
    if (!src) continue;
    if (start > cursor) parts.push({ kind: 'text', text: text.slice(cursor, start) });
    parts.push({ kind: 'image', src, raw });
    cursor = end;
    starts.lastIndex = end;
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
  return parts.length ? parts : [{ kind: 'text', text }];
}

export interface RecordImage { src: string; eventId: string; index: number }
const imageCache = new WeakMap<RawEvent, RecordImage[]>();
/** Only assigned input/result images; a preview never borrows evidence from another action. */
export function imagesForRecords(records: RawEvent[]): RecordImage[] {
  const images: RecordImage[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (!['user', 'result', 'tool_result'].includes(record.kind)) continue;
    let found = imageCache.get(record);
    if (!found) {
      found = inputImageParts(record.text).filter(part => part.kind === 'image').map((part, i) => ({ src: part.src, eventId: record.id, index: i + 1 }));
      imageCache.set(record, found);
    }
    for (const image of found) if (!seen.has(image.src)) { seen.add(image.src); images.push(image); }
  }
  return images;
}

const CHAT_IMAGE_MARKER = '[Image omitted from chat context]';
/** Text-only chat evidence. Never mutate the imported record or remove its surrounding prose. */
export function textForChat(text: string): string {
  if (!/image|\\\\u/i.test(text)) return text;
  const scrub = (value: unknown): unknown => {
    if (typeof value === 'string') return textForChat(value);
    if (Array.isArray(value)) return value.map(scrub);
    if (!value || typeof value !== 'object') return value;
    const item = value as Record<string, unknown>;
    if (['input_image', 'image_url', 'image'].includes(String(item.type))) return CHAT_IMAGE_MARKER;
    const mime = item.media_type ?? item.mimeType;
    return Object.fromEntries(Object.entries(item).map(([key, value]) => [key,
      key === 'data' && typeof mime === 'string' && mime.startsWith('image/') ? CHAT_IMAGE_MARKER : scrub(value)]));
  };
  const starts = /\{\s*"(?:\\.|[^"\\])*"\s*:/g;
  let cursor = 0, match: RegExpExecArray | null;
  const parts: string[] = [];
  while ((match = starts.exec(text))) {
    const start = match.index, end = objectEnd(text, start);
    if (end < 0) continue;
    try {
      const value = JSON.parse(text.slice(start, end));
      const clean = JSON.stringify(scrub(value));
      if (clean !== JSON.stringify(value)) {
        parts.push(text.slice(cursor, start), clean);
        cursor = end;
      }
      starts.lastIndex = end;
    } catch { /* Non-JSON evidence stays literal; inline data URIs are removed below. */ }
  }
  parts.push(text.slice(cursor));
  return parts.join('').replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/_=-]+/gi, CHAT_IMAGE_MARKER);
}
