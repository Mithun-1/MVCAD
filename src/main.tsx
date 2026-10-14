import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { loadProject } from './projectStorage';

const root = createRoot(document.getElementById('root')!);
root.render(
  <div className="workspace-loading" role="status">
    Restoring workspace…
  </div>,
);
void loadProject().then((initial) =>
  root.render(
    <React.StrictMode>
      <App initial={initial} />
    </React.StrictMode>,
  ),
);
