import React from 'react';
import { createRoot } from 'react-dom/client';
import { CampaignReader } from './campaign.jsx';

createRoot(document.getElementById('campaign-root')).render(<CampaignReader />);
