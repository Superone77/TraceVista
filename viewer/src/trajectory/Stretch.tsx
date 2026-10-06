// StretchText-style disclosure: the continuation grows out of the text the reader is on, instead of
// replacing the view. Height and opacity ease together, so nothing jumps. Content mounted already open
// still grows in: the open state is applied one frame after mounting.
import { useEffect, useState, type ReactNode } from 'react';

export default function Stretch({ open, children, className = '' }: { open: boolean; children: ReactNode; className?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const frame = requestAnimationFrame(() => setShown(open)); return () => cancelAnimationFrame(frame); }, [open]);
  return <div className={`stretch ${className}`} data-open={shown} aria-hidden={!open} inert={!open}>
    <div className="stretch-inner">{children}</div>
  </div>;
}
