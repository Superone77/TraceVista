import { useLang } from './i18n';
import type { usePlayback } from './usePlayback';
import './playback.css';

export default function PlaybackControls({ playback, onEvidence, onOpen }: {
  playback: ReturnType<typeof usePlayback>; onEvidence: (id: string) => void; onOpen: (id: string) => void;
}) {
  const { t } = useLang();
  const step = playback.step;
  if (!step) return null;
  return <section className="playback" aria-label={t('Story playback')}>
    <div className="playback-heading">
      <span>{t(playback.status === 'finished' ? 'Playback complete' : playback.playing ? 'Playing' : 'Paused')} · {playback.index + 1} / {playback.count}</span>
      <button onClick={playback.exit} aria-label={t('Exit playback and restore view')} title={t('Exit playback and restore view')}>×</button>
    </div>
    <div className="playback-caption" aria-live="polite" aria-atomic="true">
      <span className="playback-kind">{t(step.kind === 'state' ? 'System state' : step.kind === 'branch' ? 'Work phase' : 'Action')}
        {step.status === 'proposed' ? ` · ${t('Proposed only')}` : step.status === 'rejected' ? ` · ${t('Rejected')}` : ''}
        {step.relation === 'restored' ? ` · ${t('Rollback')}` : ''}</span>
      <button className="playback-title" onClick={() => { playback.pause(); onOpen(step.node); }}>{step.title}</button>
      {step.description && step.description !== step.title && <p>{step.description}</p>}
    </div>
    <div className="playback-transport">
      <button aria-label={t('Previous step')} title={t('Previous step')} disabled={playback.index === 0} onClick={() => playback.seek(playback.index - 1)}>←</button>
      <button className="playback-toggle" onClick={playback.playing ? playback.pause : playback.play}>{t(playback.playing ? 'Pause' : playback.status === 'finished' ? 'Replay' : 'Play')}</button>
      <button aria-label={t('Next step')} title={t('Next step')} disabled={playback.index >= playback.count - 1} onClick={() => playback.seek(playback.index + 1)}>→</button>
      <input aria-label={t('Playback position')} type="range" min={0} max={Math.max(0, playback.count - 1)} value={playback.index} onChange={e => playback.seek(Number(e.target.value))} />
      <select aria-label={t('Time per step')} value={playback.seconds} onChange={e => playback.setSeconds(Number(e.target.value))}>
        {[4, 8, 15].map(seconds => <option key={seconds} value={seconds}>{seconds}s</option>)}
      </select>
    </div>
    {step.events.length > 0 && <div className="playback-evidence">{step.events.slice(0, 3).map(id => <button key={id} onClick={() => { playback.pause(); onEvidence(id); }} title={t('Open original record')}>{id}</button>)}</div>}
  </section>;
}
