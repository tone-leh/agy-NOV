import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/shell.css';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary scopeLabel="agy-NOV Shell">
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
