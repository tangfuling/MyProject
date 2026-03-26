import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import bootstrap from './app/bootstrap';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>{bootstrap()}</StrictMode>
);
