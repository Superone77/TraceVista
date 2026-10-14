import { useMemo, useState } from 'react';
import type { RawEvent } from './model';
import { imagesForRecords, type RecordImage } from './input-images';
import { ImageDialog } from './RecordText';
import { useLang } from './i18n';

/** A compact visual evidence strip, available before expanding an action's raw records. */
export default function ImagePreviews({ records }: { records: RawEvent[] }) {
  const { t } = useLang();
  const images = useMemo(() => imagesForRecords(records), [records]);
  const [opened, setOpened] = useState<RecordImage | null>(null);
  if (!images.length) return null;
  return <div className="action-image-previews nodrag nopan nowheel" aria-label={t('Action images')} onClick={e => e.stopPropagation()}>
    {images.map(image => <button key={`${image.eventId}:${image.index}`} className="action-image-preview" aria-label={t('Enlarge image {n}', { n: image.index })} title={image.eventId} onClick={() => setOpened(image)}>
      <img src={image.src} alt={t('Image {n}', { n: image.index })} loading="lazy" decoding="async" />
      <span>{image.eventId}</span>
    </button>)}
    {opened && <ImageDialog src={opened.src} label={`${t('Image {n}', { n: opened.index })} · ${opened.eventId}`} close={() => setOpened(null)} />}
  </div>;
}
