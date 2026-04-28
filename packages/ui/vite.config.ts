import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import {defineConfig} from 'vite'
import {imagetools} from 'vite-imagetools'

// https://vitejs.dev/config/

export default defineConfig({
	plugins: [
		tailwindcss(),
		// React Compiler automatically memoizes components, hooks, and expressions
		// at build time. No need to manually add useMemo/useCallback/React.memo.
		// useMemo/useCallback can still be used as escape hatches for precise control.
		// If a component behaves unexpectedly, add "use no memo" directive to opt it out.
		react({
			babel: {
				plugins: ['babel-plugin-react-compiler'],
			},
		}),
		imagetools({
			// Currently we only convert SVGs in features/files/assets/file-items-thumbnails
			include: /src\/features\/files\/assets\/file-items-thumbnails\/[^?]+\.svg(\?.*)?$/,
		}),
	],
	// Vite 4.4.8+ blocks requests from unrecognized hosts to prevent DNS rebinding attacks.
	// Allow all hosts since the dev server runs inside a local Docker container and is
	// accessed via dynamic *.local hostnames (e.g. umbrel-dev.local, umbrel-dev-apps.local).
	// This only affects the dev server, not production builds.
	server: {
		allowedHosts: true,
	},
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
					// remeda: ['remeda'],
					// motion: ['framer-motion'],
					// bignumber: ['bignumber.js'],
					// other: ['react-helmet-async', 'react-error-boundary'],
					// toaster: ['sonner'],
					react: ['react', 'react-dom'],
					i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector', 'i18next-http-backend'],
					fetch: ['@tanstack/react-query', '@trpc/react-query', '@trpc/client'],
					css: ['tailwind-merge', 'clsx'],
					reactRouter: ['react-router-dom'],
					dev: ['@tanstack/react-query-devtools', 'react-json-tree'],
					// sorter: ['match-sorter'],
					// icons: ['react-icons', 'lucide-react'],
					// qr: ['react-qr-code'],
					// pin: ['rci'],
					colorThief: ['colorthief'],
				},
			},
		},
	},
})
