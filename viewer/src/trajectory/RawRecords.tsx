import type { RawEvent } from './model';
import { labels } from './labels';

function recordType(e: RawEvent) {
  if (['call', 'tool', 'tool_call'].includes(e.kind)) return { label: '工具调用', kind: 'call', icon: '↗' };
  if (['result', 'tool_result'].includes(e.kind)) return { label: '工具结果', kind: 'result', icon: '↙' };
  if (e.kind === 'thinking') return { label: '思考记录', kind: 'message', icon: '◌' };
  if (e.kind === 'user') return { label: '任务输入', kind: 'input', icon: '›' };
  if (e.kind === 'status') return { label: '执行状态', kind: 'status', icon: '·' };
  if (e.actor === 'reviewer') return { label: 'Review', kind: 'review', icon: '◎' };
  return { label: 'agent 发言', kind: 'message', icon: '◇' };
}

/** Literal source text, not summaries. A single scroll surface keeps long output intact. */
export default function RawRecords({ records }: { records: RawEvent[] }) {
  return <div className="raw-records nodrag nopan" tabIndex={0} aria-label="原始轨迹正文" onWheelCapture={e => {
    // Keep text scrolling local, but let pinch and modified wheel reach the canvas zoom handler.
    if (!e.ctrlKey && !e.metaKey && !e.currentTarget.closest('.space-pan')) e.stopPropagation();
  }}>
    {records.map((e, i) => {
      const type = recordType(e);
      return <div className="raw-record-wrap" key={e.id}>
        {i > 0 && <div className="raw-record-arrow" aria-hidden>↓</div>}
        <article className={`raw-record ${type.kind}`} data-event-id={e.id}>
          <div className="raw-record-meta"><span>{e.id}</span>{e.model && <span className="model-tag">{e.model}</span>}{e.tokens_in != null && <span title={e.tokens_scope === 'session_cumulative' ? '截至此事件的累计输入，含缓存；不是本次调用的消耗' : '日志记录的输入 token 数，不是这段正文的长度'}>{e.tokens_scope === 'session_cumulative' ? '累计输入' : e.tokens_scope === 'session_total' ? '会话输入' : '输入'} {e.tokens_in} tok</span>}</div>
          <h3><span>{type.icon}</span> {labels[e.actor ?? 'agent'] ?? e.actor} · {type.label}{e.tool ? ` · ${e.tool}` : ''}</h3>
          {e.skill && <div className="raw-skill"><span className="skill-tag">Skill · {e.skill}</span></div>}
          <pre>{e.text || '原日志没有可见正文'}</pre>
          {e.error && <div className="raw-record-error">日志标记：错误</div>}
          <div className="raw-record-source">{e.source_line != null ? `源行 ${e.source_line}` : '源行未记录'}{e.call_id ? ` · call ${e.call_id}` : ''}</div>
        </article>
      </div>;
    })}
  </div>;
}
