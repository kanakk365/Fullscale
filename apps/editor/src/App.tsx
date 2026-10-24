// The editor's layout: bars around one or two views (the plan and 3D), and the side panel.
import { useState } from 'react';
import { studio } from './app/connection.ts';
import { useEditor } from './app/store.ts';
import { saveToken } from './app/token.ts';
import { Catalog, StatusBar, Toast, ToolBar, TopBar } from './panels/Bars.tsx';
import { Inspector } from './panels/Inspector.tsx';
import { Issues } from './panels/Issues.tsx';
import { PlanView } from './plan/PlanView.tsx';
import { SceneView } from './view3d/SceneView.tsx';

export function App() {
  const connection = useEditor((s) => s.connection);
  const view = useEditor((s) => s.view);
  if (connection === 'no-token' || connection === 'unauthorized') return <TokenScreen wrong={connection === 'unauthorized'} />;
  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <ToolBar />
        <div className={`views ${view}`}>
          {view !== '3d' && <PlanView />}
          {view !== 'plan' && <SceneView />}
        </div>
        <aside className="side">
          <Catalog />
          <Inspector />
          <Issues />
        </aside>
      </div>
      <StatusBar />
      <Toast />
    </div>
  );
}

function TokenScreen({ wrong }: { wrong: boolean }) {
  const [token, setToken] = useState('');
  return (
    <div className="token-screen">
      <h1>Fullscale</h1>
      <p>{wrong ? 'That token was not accepted.' : 'Open the link that "fullscale serve" printed, or paste the studio token.'}</p>
      <p className="hint">"npm run studio" starts the studio; "npx tsx apps/server/src/cli.ts token" prints the token.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveToken(token);
          studio.start(token.trim());
        }}
      >
        {/* biome-ignore lint/a11y/noAutofocus: the token is the only thing this screen asks for */}
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="studio token" autoFocus />
        <button type="submit">Connect</button>
      </form>
    </div>
  );
}
