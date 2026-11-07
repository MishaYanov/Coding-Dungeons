import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { CampaignReader } from './reader.jsx';

const root = createRoot(document.getElementById('campaign-root'));
flushSync(() => root.render(<CampaignReader />));

// The campaign controller owns the dynamic content inside the mounted panels.
const controller = document.createElement('script');
controller.type = 'module';
controller.src = '/app.js';
controller.addEventListener('error', () => {
  document.getElementById('reader-placeholder').textContent = 'The campaign reader could not load.';
});
document.head.append(controller);
