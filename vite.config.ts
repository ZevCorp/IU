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
                marketing: resolve(__dirname, 'marketing-pmv.html'),
                poc: resolve(__dirname, 'poc-face.html'),
                dashboard: resolve(__dirname, 'dashboard.html'),
                download: resolve(__dirname, 'download.html'),
            },
        },
    },
});
