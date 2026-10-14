import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { inputImageParts } from './input-images';
import { useLang } from './i18n';
import './input-images.css';

export function ImageDialog({ src, label, close }: { src: string; label: string; close: () => void }) {
  const { t } = useLang();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="input-image-dialog" aria-label={label}
    onCancel={e => { e.preventDefault(); close(); }} onKeyDown={e => e.stopPropagation()}
    onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="input-image-toolbar"><span>{label}</span><button type="button" autoFocus onClick={close}>{t('Close image')}</button></div>
    <img src={src} alt={label} />
  </dialog>, document.body);
}

function Attachment({ src, raw, index }: { src: string; raw: string; index: number }) {
  const { t } = useLang();
  const [enlarged, setEnlarged] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = t('Image {n}', { n: index });
  return <div className="input-image-attachment">
    {failed ? <p role="status">{t('Image could not be decoded. The original data is available below.')}</p> :
      <button type="button" className="input-image-thumbnail" aria-label={t('Enlarge image {n}', { n: index })} onClick={() => setEnlarged(true)}>
        <img src={src} alt={label} loading="lazy" decoding="async" onError={() => setFailed(true)} />
        <span>{label} · {t('Click to enlarge')}</span>
      </button>}
    <details onToggle={e => setSourceOpen(e.currentTarget.open)}><summary>{t('Original image record')}</summary>{sourceOpen && <pre>{raw}</pre>}</details>
    {enlarged && <ImageDialog src={src} label={label} close={() => setEnlarged(false)} />}
  </div>;
}

/** Shared by the story, canvas and evidence inspector. Task inputs and tool results share attachment previews. */
export default function RecordText({ text, kind }: { text: string; kind: string }) {
  const { t } = useLang();
  const parts = useMemo(() => ['user', 'result', 'tool_result'].includes(kind) ? inputImageParts(text) : [{ kind: 'text' as const, text }], [text, kind]);
  let imageIndex = 0;
  return <>{parts.map((part, i) => part.kind === 'image'
    ? <Attachment key={`${i}:${part.src.length}`} src={part.src} raw={part.raw} index={++imageIndex} />
    : <pre key={i}>{part.text || t('No visible text in the source log')}</pre>)}</>;
}
