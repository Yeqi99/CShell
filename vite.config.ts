import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: './', resolve: { conditions: ['worker', 'module', 'browser', 'development|production'] }, plugins: [react()], define: {__CSHELL_PRO__: process.env.CSHELL_EDITION === 'pro'}, build: { outDir: 'dist/renderer' } });
