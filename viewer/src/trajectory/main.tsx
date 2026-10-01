import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import StateReader from './StateReader';

createRoot(document.getElementById('root')!).render(<StrictMode><StateReader /></StrictMode>);
