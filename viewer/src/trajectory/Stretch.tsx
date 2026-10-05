// StretchText-style disclosure: the continuation grows out of the text the reader is on, instead of
// replacing the view. Height and opacity ease together, so nothing jumps.
import type { ReactNode } from 'react';

export default function Stretch({ open, children, className = '' }: { open: boolean; children: ReactNode; className?: string }) {
  return <div className={`stretch ${className}`} data-open={open} aria-hidden={!open} inert={!open}>
    <div className="stretch-inner">{children}</div>
  </div>;
}
