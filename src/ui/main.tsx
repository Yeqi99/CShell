import { ClientApplication } from './components/ClientPanel';
import { createRoot } from 'react-dom/client';
import { FloatingTerminal } from './components/FloatingTerminal';
import { App } from './App';
import { MonitorViewWindow } from './components/MonitorViewWindow';
import './styles.css';
const report = (error: unknown) => {
  try { window.cshell.reportError({ message: error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown renderer error',
    stack: error instanceof Error ? error.stack : undefined }); } catch {}
};
window.addEventListener('error', event => report(event.error ?? event.message));
window.addEventListener('unhandledrejection', event => report(event.reason));
createRoot(document.getElementById('root')!, {
  onUncaughtError: report, onCaughtError: report, onRecoverableError: report,
}).render(
  new URLSearchParams(location.search).has('monitorView') ? <MonitorViewWindow/> : new URLSearchParams(location.search).has('client') ? (
    <ClientApplication />
  ) : new URLSearchParams(location.search).has('floating') ? (
    <FloatingTerminal />
  ) : (
    <App />
  ),
);
