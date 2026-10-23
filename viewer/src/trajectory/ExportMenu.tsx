import { useEffect, useRef, useState } from 'react';
import { useLang } from './i18n';

export default function ExportMenu({ busy, onHtml, onJson }: {
  busy: boolean; onHtml: () => void; onJson: () => void;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dismiss = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) dismiss();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  return <div ref={root} className="export-menu"
    onPointerEnter={event => { if (event.pointerType === 'mouse' && !busy) setOpen(true); }}
    onPointerLeave={event => { if (event.pointerType === 'mouse') dismiss(); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dismiss(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); trigger.current?.focus(); }
    }}>
    <button ref={trigger} aria-expanded={open} aria-controls="export-format-options" aria-busy={busy}
      disabled={busy} onClick={() => setOpen(true)}>
      {t(busy ? 'Exporting…' : 'Export')}
    </button>
    <div id="export-format-options" className="export-menu-popover" hidden={!open}>
      <div className="export-menu-options" role="group" aria-label={t('Export format')}>
        <button disabled={busy} onClick={() => { dismiss(); onHtml(); }}>HTML</button>
        <button disabled={busy} onClick={() => { dismiss(); onJson(); }}>JSON</button>
      </div>
    </div>
  </div>;
}
