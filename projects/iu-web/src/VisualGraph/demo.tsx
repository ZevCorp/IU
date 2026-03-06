// Demo Entry Point for VisualGraph
// Standalone React app to test the cinematic graph

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { CinematicGraph } from './CinematicGraph';

function App() {
    return (
        <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0 }}>
            <CinematicGraph
                onNodeFocus={(nodeId) => console.log('Focused:', nodeId)}
                onNodeConfirm={(nodeId) => console.log('Confirmed:', nodeId)}
            />
        </div>
    );
}

// Cache root for HMR
let root: Root | null = null;

const container = document.getElementById('visual-graph-root');
if (container) {
    if (!root) {
        root = createRoot(container);
    }
    root.render(<App />);
}

export { App as VisualGraphDemo };
