import path from 'node:path'
import react from '@vitejs/plugin-react-swc'
import {defineConfig, loadEnv} from 'vite'

export default defineConfig(({mode}) => {
	// Load env file based on `mode` in the current working directory.
	// Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
	const env = loadEnv(mode, path.resolve(__dirname), '')

	console.log(env.VITE_PROXY_BACKEND)

	return {
		plugins: [react()],
		root: 'stories',
		publicDir: '../public',

		resolve: {
			alias: {
				'@/': `${path.resolve(__dirname, '../src')}/`,
				'@stories/': `${path.resolve(__dirname, './src')}/`,
			},
		},

		build: {
			outDir: '../dist',
		},

		// Proxy requests to the backend server.
		// This is useful when running stories locally and want to connect to a remote backend.
		server: {
			proxy: {
				'/trpc': env.VITE_PROXY_BACKEND,
			},
		},
	}
})
