import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 3000,
        allowedHosts: true,
        open: true
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                graph: resolve(__dirname, 'graph.html'),
            },
        },
    },
});
