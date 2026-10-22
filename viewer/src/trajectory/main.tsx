import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import StateReader from './StateReader';
import { initializeMiniAppStorage } from './chat-store';

async function start() {
  if (import.meta.env.VITE_TRACEVISTA_MINIAPP === '1') {
    const storage = await initializeMiniAppStorage(fetch, message => {
      let alert = document.getElementById('miniapp-storage-error');
      if (!alert) { alert = document.createElement('div'); alert.id = 'miniapp-storage-error'; alert.className = 'miniapp-storage-error'; alert.setAttribute('role', 'alert'); document.body.append(alert); }
      alert.textContent = message;
      const retry = document.createElement('button'); retry.textContent = 'Retry save';
      retry.onclick = () => { void storage.flush().then(() => alert?.remove()).catch(() => {}); };
      alert.append(retry);
    });
    window.addEventListener('beforeunload', event => {
      if (!storage.hasPending()) return;
      event.preventDefault(); event.returnValue = '';
    });
  }
  createRoot(document.getElementById('root')!).render(<StrictMode><StateReader /></StrictMode>);
}
void start().catch(error => {
  const root = document.getElementById('root')!;
  const message = document.createElement('p'); message.setAttribute('role', 'alert');
  message.textContent = error instanceof Error ? error.message : 'Could not open TraceVista.';
  const retry = document.createElement('button'); retry.textContent = 'Refresh MiniApp'; retry.onclick = () => location.reload();
  root.replaceChildren(message, retry);
});
