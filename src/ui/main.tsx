import { ClientApplication } from './components/ClientPanel';
import { createRoot } from 'react-dom/client';
import { FloatingTerminal } from './components/FloatingTerminal';
import { App } from './App';
import './styles.css';
createRoot(document.getElementById('root')!).render(
  new URLSearchParams(location.search).has('client') ? (
    <ClientApplication />
  ) : new URLSearchParams(location.search).has('floating') ? (
    <FloatingTerminal />
  ) : (
    <App />
  ),
);
