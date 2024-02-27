import path from 'node:path'
import react from '@vitejs/plugin-react-swc'
import {defineConfig} from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react()],
	server: {
		proxy: {
			'/v1': 'http://localhost:2000',
		},
	},
	resolve: {
		alias: {
			'@/': `${path.resolve(__dirname, '../src')}/`,
		},
	},
	build: {
		rollupOptions: {
			input: {
				index: path.resolve(__dirname, 'index.html'),
			},
			output: {
				minifyInternalExports: true,
			},
		},
		outDir: 'dist-app-auth',
	},
})
