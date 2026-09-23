import {fileURLToPath} from 'node:url';
import react from '@vitejs/plugin-react';
import {defineConfig, loadEnv} from 'vite';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig(({mode}) => {
	const environment = loadEnv(mode, repositoryRoot, '');
	return {
		plugins: [react()],
		envDir: repositoryRoot,
		server: {
			host: '0.0.0.0',
			port: 5173,
			strictPort: true,
			proxy: {
				'/api': {
					target: environment.API_PROXY_TARGET ?? `http://127.0.0.1:${environment.PORT ?? '3000'}`,
				},
			},
		},
	};
});
