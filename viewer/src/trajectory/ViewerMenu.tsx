import { useEffect, useRef, useState, type ReactNode } from 'react';

export default function ViewerMenu({ children }: { children: (dismiss: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dismiss = () => { setOpen(false); trigger.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  return <div className="viewer-menu" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); dismiss(); }
  }} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} className="viewer-menu-trigger" aria-label="Viewer menu" title="Viewer menu"
      aria-haspopup="dialog" aria-expanded={open} aria-controls="viewer-menu-panel" onClick={() => setOpen(value => !value)}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" /></svg>
    </button>
    <div id="viewer-menu-panel" className="viewer-menu-panel" role="dialog" aria-label="Viewer menu" hidden={!open}>
      {children(dismiss)}
    </div>
  </div>;
}
