import { useCallback, useEffect, useId, useRef, useState } from 'react';
import './example-menu.css';
import { useLang } from './i18n';

interface ExampleEntry {
  id: string;
  title: string;
  agent?: string;
  task?: string;
}

export default function ExampleMenu({ examples, loading = false }: { examples: ExampleEntry[]; loading?: boolean }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useId();

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const show = () => { cancelClose(); setOpen(true); };
  const dismiss = useCallback((restoreFocus = false) => {
    cancelClose();
    // Focus first so the focus handler cannot reopen the panel after dismissal.
    if (restoreFocus) trigger.current?.focus();
    setOpen(false);
  }, [cancelClose]);
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      // Mouse movement must not hide links while someone is using the keyboard.
      if (!root.current?.querySelector(':focus-visible')) setOpen(false);
    }, 220);
  };

  useEffect(() => cancelClose, [cancelClose]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      dismiss(!!root.current?.contains(document.activeElement));
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, dismiss]);

  if (!examples.length) return null;
  return <div className="example-menu" ref={root}
    onPointerEnter={event => { if (event.pointerType !== 'touch') show(); }}
    onPointerLeave={event => { if (event.pointerType !== 'touch') scheduleClose(); }}
    onFocus={show}
    onBlur={event => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) dismiss();
    }}>
    <button ref={trigger} type="button" className="example-menu-trigger" aria-expanded={open}
      aria-controls={panelId} aria-busy={loading} onClick={show} onKeyDown={event => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault(); show();
        requestAnimationFrame(() => panel.current?.querySelector<HTMLAnchorElement>('a')?.focus());
      }}>
      {t(loading ? 'Loading…' : 'View examples')} <span aria-hidden="true">▾</span>
    </button>
    <nav ref={panel} id={panelId} className="example-menu-panel" aria-label={t('Example trajectories')} hidden={!open}>
      <ul className="example-menu-list">{examples.map(example => {
        const metadata = [example.agent, example.task].filter(Boolean).join(' · ');
        return <li key={example.id}><a href={`?example=${encodeURIComponent(example.id)}`}>
          <span className="example-menu-title">{example.title}</span>
          {metadata && <span className="example-menu-meta">{metadata}</span>}
        </a></li>;
      })}</ul>
    </nav>
  </div>;
}
