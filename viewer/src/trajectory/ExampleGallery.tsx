import { useId, useLayoutEffect, useRef } from 'react';
import { useLang } from './i18n';
import './example-gallery.css';

interface ExampleEntry {
  id: string;
  title: string;
  description?: string;
  agent?: string;
  task?: string;
  thumbnail?: string;
  thumbnailCrop?: [number, number, number, number];
}

export default function ExampleGallery({ examples }: { examples: ExampleEntry[] }) {
  const { t } = useLang();
  const headingId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const originalList = useRef<HTMLUListElement>(null);
  const paused = useRef({ hover: false, focus: false, pointer: false, touch: false, until: 0 });

  useLayoutEffect(() => {
    const scroller = viewport.current;
    const list = originalList.current;
    if (!scroller || !list || !examples.length) return;

    const compact = window.matchMedia('(max-width: 999px)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let lastTime = 0;
    let distance = 0;
    let offset = scroller.scrollLeft;
    let lastWrittenOffset = offset;

    const measure = () => {
      // Keep the accepted desktop card sizes; narrow screens retain 220px cards.
      const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
      const style = getComputedStyle(scroller);
      const availableWidth = scroller.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const cardWidth = compact.matches ? 220 : (availableWidth - gap * (examples.length - 1)) / examples.length;
      scroller.style.setProperty('--example-card-width', `${Math.max(1, cardWidth)}px`);
      distance = list.getBoundingClientRect().width + gap;
      offset = scroller.scrollLeft % distance;
      scroller.scrollLeft = offset;
      lastWrittenOffset = scroller.scrollLeft;
      lastTime = 0;
    };

    const advance = (now: number) => {
      const interaction = paused.current;
      const current = scroller.scrollLeft;
      if (current !== lastWrittenOffset) offset = current;
      if (lastTime && distance > 0 && !interaction.hover && !interaction.focus
        && !interaction.pointer && !interaction.touch && now >= interaction.until) {
        // Retain fractional pixels even when the browser rounds scrollLeft.
        offset = (offset + Math.min(now - lastTime, 64) * .02) % distance;
        scroller.scrollLeft = offset;
      }
      lastWrittenOffset = scroller.scrollLeft;
      lastTime = now;
      frame = requestAnimationFrame(advance);
    };

    const updateMotion = () => {
      cancelAnimationFrame(frame);
      measure();
      if (!reducedMotion.matches && examples.length > 1) frame = requestAnimationFrame(advance);
    };
    const resize = new ResizeObserver(measure);
    resize.observe(scroller);
    compact.addEventListener('change', measure);
    reducedMotion.addEventListener('change', updateMotion);
    updateMotion();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      compact.removeEventListener('change', measure);
      reducedMotion.removeEventListener('change', updateMotion);
    };
  }, [examples.length]);

  const finishPointer = () => {
    paused.current.pointer = false;
    // Give touch scrolling and its momentum time to settle before resuming.
    paused.current.until = performance.now() + 1800;
  };

  if (!examples.length) return <section className="example-gallery" id="examples" aria-labelledby={headingId}>
    <div className="example-gallery-header">
      <h2 className="example-gallery-heading" id={headingId}>{t('Example Trajectories')}</h2>
    </div>
    <a className="example-gallery-explore" href="https://tracevista.pages.dev/#examples" target="_blank" rel="noopener noreferrer">
      {t('Explore examples on TraceVista')}<span aria-hidden="true">↗</span>
    </a>
  </section>;

  const cards = (duplicate: boolean) => examples.map(example => {
      const metadata = [example.agent, example.task].filter(Boolean).join(' · ');
      const [x, y, width, height] = example.thumbnailCrop ?? [0, 0, 1280, 720];

      return <li key={example.id}>
        <a className="example-gallery-card" href={`?example=${encodeURIComponent(example.id)}`}
          tabIndex={duplicate ? -1 : undefined}
          title={example.description}>
          <div className="example-gallery-preview">
            <div className="example-gallery-crop" style={{ aspectRatio: `${width} / ${height}` }}>
              <img src={`${import.meta.env.BASE_URL}example-thumbnails/${example.thumbnail ?? `${example.id}.png`}`}
                width={1280} height={720} loading="lazy" decoding="async" alt=""
                style={{
                  width: `${1280 / width * 100}%`, height: `${720 / height * 100}%`,
                  left: `${-x / width * 100}%`, top: `${-y / height * 100}%`,
                }} />
            </div>
          </div>
          <div className="example-gallery-copy">
            <h3 className="example-gallery-title" title={example.title}>{example.title}</h3>
            {metadata && <p className="example-gallery-meta" title={metadata}>{metadata}</p>}
          </div>
        </a>
      </li>;
    });

  return <section className="example-gallery" id="examples" aria-labelledby={headingId}>
    <div className="example-gallery-header">
      <h2 className="example-gallery-heading" id={headingId}>{t('Example Trajectories')}</h2>
    </div>
    <div className="example-gallery-viewport" ref={viewport}
      onPointerEnter={event => { if (event.pointerType !== 'touch') paused.current.hover = true; }}
      onPointerLeave={event => {
        paused.current.hover = false;
        if (event.pointerType !== 'touch') paused.current.pointer = false;
      }}
      onPointerDown={() => { paused.current.pointer = true; }}
      onPointerUp={finishPointer} onPointerCancel={finishPointer}
      onTouchStart={() => { paused.current.touch = true; }}
      onTouchEnd={() => { paused.current.touch = false; finishPointer(); }}
      onTouchCancel={() => { paused.current.touch = false; finishPointer(); }}
      onWheel={() => { paused.current.until = performance.now() + 1800; }}
      onScroll={() => {
        if (performance.now() < paused.current.until) paused.current.until = performance.now() + 1800;
      }}
      onFocusCapture={() => { paused.current.focus = true; }}
      onBlurCapture={event => {
        paused.current.focus = event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget);
      }}>
      <div className="example-gallery-track">
        <ul className="example-gallery-grid" ref={originalList}>{cards(false)}</ul>
        {examples.length > 1 && <ul className="example-gallery-grid example-gallery-clone" aria-hidden="true">{cards(true)}</ul>}
      </div>
    </div>
  </section>;
}
