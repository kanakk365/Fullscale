// Start the editor: connect to the studio with the token, and let agents ask for 3D pictures.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { setRenderer, studio } from './app/connection.ts';
import { getState, setState } from './app/store.ts';
import { takeToken } from './app/token.ts';
import { renderSnapshot } from './view3d/snapshot.ts';
import './styles.css';

const token = takeToken();
if (token) studio.start(token);
else setState({ connection: 'no-token' });

setRenderer(async (view, size) => {
  const home = getState().home;
  if (!home) throw new Error('The editor has no home loaded yet.');
  return renderSnapshot(home, view, size);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
