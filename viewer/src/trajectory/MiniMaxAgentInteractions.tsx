import { useSyncExternalStore } from 'react';
import type { HostedChatConnection } from './hosted-chat';
import { isMiniMaxChatConnection } from './minimax-chat';
import type { MiniMaxChatConnection } from './minimax-chat';
import { useLang } from './i18n';
import './minimax-chat.css';

function InteractionCards({ connection }: { connection: MiniMaxChatConnection }) {
  const { t } = useLang();
  const store = connection.interactions;
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  if (!items.length) return null;
  return <aside className="minimax-agent-interactions" aria-label={t('MiniMax Agent requests')}>
    {items.map(item => <section key={item.id} className="minimax-agent-interaction" aria-label={t(item.kind === 'permission' ? 'Agent permission request' : item.kind === 'question' ? 'Agent question' : 'Agent request status')}>
      <strong>{t(item.kind === 'permission' ? 'MiniMax Agent needs permission' : item.kind === 'question' ? 'MiniMax Agent has a question' : 'Check the MiniMax Agent session')}</strong>
      {item.kind === 'permission' ? <>
        <p>{t('The Agent can use files, commands, and MCP tools. Review this action before allowing it.')}</p>
        <p><b>{item.toolName}</b></p>
        <p>{item.reason}</p>
        {item.toolInput && <details><summary>{t('Requested tool input')}</summary><pre>{item.toolInput}</pre></details>}
      </> : item.kind === 'question' ? <>
        <p>{t('This TraceVista request has ended. Open the Agent to answer its question; its continuation will appear in MiniMax Code.')}</p>
        {item.request?.title && <p><b>{item.request.title}</b></p>}
        {Array.isArray(item.request?.steps) && item.request.steps.map(step => <div key={step.id}>
          <p><b>{step.question}</b></p>
          {step.description && <p>{step.description}</p>}
          {Array.isArray(step.options) && step.options.length > 0 && <ul>{step.options.map(option => <li key={option.id}>{option.label}{option.description && <> — {option.description}</>}</li>)}</ul>}
        </div>)}
        {item.request?.modePayload && <details><summary>{t('Agent question details')}</summary><pre>{JSON.stringify(item.request.modePayload, null, 2)}</pre></details>}
      </> : <p>{t(item.reason === 'cancelled'
        ? 'Cancellation was requested. Check the Agent session before trying again.'
        : item.reason === 'timeout' ? 'The request timed out. The Agent may still have run; check its session before trying again.'
          : 'The request outcome is unknown. Check the Agent session before trying again.')}</p>}
      {item.error && <p className="minimax-agent-error" role="alert">{item.error}</p>}
      <div className="minimax-agent-actions">
        {item.kind === 'permission' && <>
          <button type="button" disabled={item.busy} onClick={() => void store.reply(item.id, 'deny')}>{t('Deny')}</button>
          <button type="button" disabled={item.busy} onClick={() => void store.reply(item.id, 'allowOnce')}>{t('Allow once')}</button>
        </>}
        <button type="button" disabled={item.busy} onClick={() => void store.open(item.id)}>{t('Open MiniMax Agent')}</button>
        {item.kind !== 'permission' && <button type="button" disabled={item.busy} onClick={() => store.dismiss(item.id)}>{t('Dismiss')}</button>}
      </div>
    </section>)}
  </aside>;
}

/** Mount beside the viewer, so Agent interaction stays reachable above an open Chat dialog. */
export default function MiniMaxAgentInteractions({ connection }: { connection: HostedChatConnection | null | undefined }) {
  return isMiniMaxChatConnection(connection) ? <InteractionCards connection={connection} /> : null;
}
