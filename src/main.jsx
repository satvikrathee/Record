import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Auto-reload if an outdated Vite chunk fails to load
window.addEventListener('vite:preloadError', () => {
  window.location.reload();
});

// Register service worker with auto-update listener
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.onupdatefound = () => {
        const installingWorker = reg.installing;
        if (installingWorker) {
          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New content is available; auto reload the page
              window.location.reload();
            }
          };
        }
      };
    }).catch((err) => {
      console.error('SW registration failed:', err);
    });
  });
}
