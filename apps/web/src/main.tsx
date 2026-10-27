import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// Service worker solo en producción: en desarrollo serviría archivos viejos.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
