import { useEffect, useState } from 'react';
import './instructions.css';
import { useLang } from './i18n';

const installPrompt = 'Install skills/tracevista-skill from https://github.com/Superone77/TraceVista';
const conversionPrompt = 'Use tracevista-skill to convert [trajectory file or folder] into a complete .agent-state.json, then open https://tracevista.pages.dev/ in my browser and import it.';

function CopyBlock({ text, label }: { text: string; label: string }) {
  const { t } = useLang();
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (status !== 'copied') return;
    const timer = window.setTimeout(() => setStatus('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);
  return <div className="instruction-copy-block">
    <button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setStatus('copied'); }
      catch { setStatus('failed'); }
    }} aria-label={t('Copy {what}', { what: label })} title={status === 'copied' ? t('Copied') : t('Copy {what}', { what: label })}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        {status === 'copied' ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>}
      </svg>
    </button>
    <p>{text}</p>
    <span className={status === 'failed' ? 'instruction-copy-error' : 'instruction-copy-status'} role="status">{status === 'failed' ? t('Could not copy automatically. Select the text above to copy it manually.') : status === 'copied' ? t('Copied to clipboard') : ''}</span>
  </div>;
}

export default function Instructions() {
  const { t } = useLang();
  return <section className="instructions" aria-labelledby="instructions-title">
    <h2 id="instructions-title">{t('Copy to Your Agent')}</h2>
    <div className="instruction-steps">
      <section className="instruction-step" aria-labelledby="instruction-install">
        <div className="instruction-step-title"><span>01</span><h3 id="instruction-install">{t('Install the skill')}</h3></div>
        <CopyBlock text={installPrompt} label={t('installation prompt')} />
      </section>
      <section className="instruction-step" aria-labelledby="instruction-use">
        <div className="instruction-step-title"><span>02</span><h3 id="instruction-use">{t('Convert & open')}</h3></div>
        <CopyBlock text={conversionPrompt} label={t('conversion prompt')} />
      </section>
    </div>
  </section>;
}
