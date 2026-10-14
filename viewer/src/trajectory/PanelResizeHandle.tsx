import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

export default function PanelResizeHandle({ label, width, onResize, onResizeEnd }: {
  label: string; width: { now: number; min: number; max: number };
  onResize: (px: number) => void; onResizeEnd: (reset?: boolean) => void;
}) {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  function drag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); cleanup.current?.();
    const handle = event.currentTarget, pointer = event.pointerId;
    const startX = event.clientX, startWidth = width.now;
    handle.setPointerCapture(pointer);
    document.body.classList.add('resizing-panel');
    const move = (next: PointerEvent) => {
      if (next.pointerId === pointer) onResize(startWidth + startX - next.clientX);
    };
    const finish = (next: PointerEvent) => { if (next.pointerId === pointer) { cleanup.current?.(); onResizeEnd(); } };
    cleanup.current = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      handle.removeEventListener('lostpointercapture', finish);
      cleanup.current = null;
      if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
      document.body.classList.remove('resizing-panel');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
  }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 64 : 16;
    const next = event.key === 'ArrowLeft' ? width.now + step : event.key === 'ArrowRight' ? width.now - step
      : event.key === 'Home' ? width.min : event.key === 'End' ? width.max : null;
    if (next == null) return;
    event.preventDefault(); onResize(next); onResizeEnd();
  }
  return <div className="chat-resize" role="separator" aria-orientation="vertical" tabIndex={0}
    aria-label={label} title={label} aria-valuenow={Math.round(width.now)}
    aria-valuemin={Math.round(width.min)} aria-valuemax={Math.round(width.max)}
    onPointerDown={drag} onKeyDown={keys} onDoubleClick={() => onResizeEnd(true)} />;
}
