import React from 'react';
import { createRoot } from 'react-dom/client';
import { CampaignReader } from './campaign.jsx';

const root = createRoot(document.getElementById('campaign-root'));

if (import.meta.env.MODE === 'mobile') {
  import('./mobile-controls.jsx').then(({MobileControls}) => root.render(<CampaignReader mobileControls={MobileControls} />))
    .catch(() => { document.getElementById('campaign-root').textContent = 'World 1 could not start. Reload to try again.'; });
} else {
  root.render(<CampaignReader />);
}
