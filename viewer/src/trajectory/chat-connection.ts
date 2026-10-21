import { streamChat } from './providers';
import type { HostedChatConnection, HostedModelInfo } from './hosted-chat';
import { buildChat, type ChatTurn, type ContextOptions } from './chat';
import { buildSmartContext } from './smartContext';
import type { Graph } from './model';

/** Both smart-context rounds and direct answers use the selected connection. */
export function chatTransport(host: Pick<HostedChatConnection, 'stream'> | null): typeof streamChat {
  return host ? (_settings, system, messages, onText, signal, onStatus, outputTokens) =>
    host.stream(system, messages, onText, signal, onStatus, outputTokens) : streamChat;
}

const positive = (n: unknown): number | undefined => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : undefined;
export function hostedBudget(model: HostedModelInfo | null) {
  const contextWindow = positive(model?.contextWindow);
  const outputTokens = Math.min(4096, positive(model?.maxOutputTokens) ?? Infinity,
    contextWindow ? Math.max(1, Math.floor(contextWindow / 2)) : Infinity);
  return { contextWindow, outputTokens, inputTokens: contextWindow ? Math.max(1, contextWindow - outputTokens) : 96000,
    source: contextWindow ? 'Host model' : 'Local default for unknown models' };
}
export const hostedBudgetKey = (model: HostedModelInfo | null) => JSON.stringify(['hosted', model?.provider ?? '', model?.model ?? '']);

/** The session model can change while the viewer stays open. Rebuild before sending. */
export async function prepareHostedContext(host: Pick<HostedChatConnection, 'getModel'>, signal: AbortSignal, request: {
  graph: Graph; focus: string | null; question: string; history: ChatTurn[]; strategy: 'smart' | 'direct';
  mode: ContextOptions['mode']; compression: ContextOptions['compression']; inputBudgets: Record<string, number>;
}) {
  const model = await host.getModel(signal);
  signal.throwIfAborted();
  const budget = hostedBudget(model), key = hostedBudgetKey(model);
  const inputTokens = Object.hasOwn(request.inputBudgets, key) ? request.inputBudgets[key] : budget.inputTokens;
  const { graph, focus, question, history } = request;
  const smartPlan = request.strategy === 'smart' ? buildSmartContext(graph, focus, question, history, { inputTokens }) : null;
  const bundle = smartPlan ?? buildChat(graph, focus, question, history, { mode: request.mode, compression: request.compression, inputTokens });
  return { model, budget, smartPlan, bundle };
}
