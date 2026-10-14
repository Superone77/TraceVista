import type { RawEvent } from './model';
import { labels } from './labels';
import { useLang } from './i18n';

function recordType(e: RawEvent) {
  if (['call', 'tool', 'tool_call'].includes(e.kind)) return { label: 'Tool call', kind: 'call', icon: '↗' };
  if (['result', 'tool_result'].includes(e.kind)) return { label: 'Tool result', kind: 'result', icon: '↙' };
  if (e.kind === 'thinking') return { label: 'Thinking record', kind: 'message', icon: '◌' };
  if (e.kind === 'user') return { label: 'Task input', kind: 'input', icon: '›' };
  if (e.kind === 'status') return { label: 'Execution status', kind: 'status', icon: '·' };
  if (e.actor === 'reviewer') return { label: 'Review', kind: 'review', icon: '◎' };
  return { label: 'Agent message', kind: 'message', icon: '◇' };
}

/** Literal source text, not summaries. A single scroll surface keeps long output intact. */
export default function RawRecords({ records, onEvidence }: { records: RawEvent[]; onEvidence?: (id: string) => void }) {
  const { t } = useLang();
  return <div className="raw-records nodrag nopan" tabIndex={0} aria-label={t('Raw trajectory text')} onWheelCapture={e => {
    // Keep text scrolling local, but let pinch and modified wheel reach the canvas zoom handler.
    if (!e.ctrlKey && !e.metaKey && !e.currentTarget.closest('.space-pan')) e.stopPropagation();
  }}>
    {records.map((e, i) => {
      const type = recordType(e);
      return <div className="raw-record-wrap" key={e.id}>
        {i > 0 && <div className="raw-record-arrow" aria-hidden>↓</div>}
        <article className={`raw-record ${type.kind}`} data-event-id={e.id}>
          <div className="raw-record-meta">{onEvidence ? <button className="raw-event-reference" onClick={() => onEvidence(e.id)}>{e.id} ↗</button> : <span>{e.id}</span>}{e.model && <span className="model-tag">{e.model}</span>}{e.tokens_in != null && <span title={t(e.tokens_scope === 'session_cumulative' ? 'Cumulative input through this event, including cached tokens; not the input token count for this call' : 'Input tokens reported in the log; not the length of this text')}>{t(e.tokens_scope === 'session_cumulative' ? 'Cumulative input' : e.tokens_scope === 'session_total' ? 'Session input' : 'Input')} {e.tokens_in} tok</span>}</div>
          <h3><span>{type.icon}</span> {t(labels[e.actor ?? 'agent'] ?? e.actor ?? '')} · {t(type.label)}{e.tool ? ` · ${e.tool}` : ''}</h3>
          {e.skill && <div className="raw-skill"><span className="skill-tag">Skill · {e.skill}</span></div>}
          <pre>{e.text || t('No visible text in the source log')}</pre>
          {e.error && <div className="raw-record-error">{t('Marked as an error in the log')}</div>}
          <div className="raw-record-source">{e.source_line != null ? t('Source line {n}', { n: e.source_line }) : t('Source line not recorded')}{e.call_id ? ` · call ${e.call_id}` : ''}</div>
        </article>
      </div>;
    })}
  </div>;
}
