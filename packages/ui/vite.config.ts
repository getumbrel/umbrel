import path from 'node:path'
import react from '@vitejs/plugin-react-swc'
import {defineConfig} from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@/': `${path.resolve(__dirname, 'src')}/`,
		},
	},
	build: {
		rollupOptions: {
			output: {
				minifyInternalExports: true,
				manualChunks: {
					remeda: ['remeda'],
					motion: ['framer-motion'],
					bignumber: ['bignumber.js'],
					i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector', 'i18next-http-backend'],
					fetch: ['@tanstack/react-query', '@trpc/react-query', '@trpc/client'],
					css: ['tailwind-merge', 'clsx'],
					dev: ['@tanstack/react-query-devtools', 'react-json-tree'],
					sorter: ['match-sorter'],
					icons: ['react-icons', 'lucide-react'],
					qr: ['react-qr-code'],
					pin: ['rci'],
					colorThief: ['colorthief'],
				},
			},
		},
	},
})
