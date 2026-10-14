import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { presets } from './providers';
import './provider-picker.css';

const groups = ['Cloud APIs', 'Local servers', 'Custom'] as const;
const options = Object.entries(presets);

/** The browse position starts at the top, independently of the saved selection. */
export default function ProviderPicker({ value, onChange, disabled }: {
  value: string; onChange: (value: string) => void; disabled: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 320 });

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current!.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upward = below < 200 && above > below;
      const maxHeight = Math.min(320, Math.max(80, upward ? above : below));
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: upward ? rect.top - maxHeight - 4 : rect.bottom + 4, width, maxHeight });
    }
    place();
    menu.current?.focus({ preventScroll: true });
    if (menu.current) menu.current.scrollTop = 0;
    // Keep the popup anchored when its scrollable settings panel moves.
    const scroll = (event: Event) => { if (event.target !== menu.current) place(); };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true); };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function close() { setOpen(false); trigger.current?.focus({ preventScroll: true }); }
  function choose(next: string) {
    // Browsing (or reselecting the current provider) must not clear a user's connection.
    if (next !== value) onChange(next);
    close();
  }
  function openMenu() { setActive(-1); setOpen(true); }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { close(); return; }
    if ((event.key === 'Enter' || event.key === ' ') && active >= 0) {
      event.preventDefault(); choose(options[active][0]); return;
    }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : event.key === 'ArrowDown' ? Math.min(active + 1, options.length - 1)
      : event.key === 'ArrowUp' ? active < 0 ? options.length - 1 : Math.max(0, active - 1) : null;
    if (next == null) return;
    event.preventDefault(); setActive(next);
    menu.current?.querySelector(`#${CSS.escape(`${id}-${next}`)}`)?.scrollIntoView({ block: 'nearest' });
  }

  return <>
    <button ref={trigger} className="provider-trigger" type="button" disabled={disabled}
      aria-label="Model provider" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => open ? close() : openMenu()}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openMenu(); } }}>
      <span>{presets[value]?.label ?? value}</span><span aria-hidden="true">▾</span>
    </button>
    {open && createPortal(<div ref={menu} id={id} className="provider-menu nodrag nopan nowheel" role="listbox"
      aria-label="Model provider" tabIndex={-1} aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
      style={position} onKeyDown={keyDown}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) setOpen(false); }}>
      {groups.map(group => <div key={group} role="group" aria-label={group}>
        <div className="provider-group" aria-hidden="true">{group}</div>
        {options.filter(([, preset]) => preset.group === group).map(([key, preset]) => {
          const index = options.findIndex(([option]) => option === key);
          return <div key={key} id={`${id}-${index}`} role="option" aria-selected={key === value}
            className={`provider-option${active === index ? ' active' : ''}`}
            onPointerDown={event => event.preventDefault()} onClick={() => choose(key)}>
            <span aria-hidden="true">{key === value ? '✓' : ''}</span>{preset.label}
          </div>;
        })}
      </div>)}
    </div>, document.body)}
  </>;
}
