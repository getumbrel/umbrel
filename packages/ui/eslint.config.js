import js from '@eslint/js'
import pluginQuery from '@tanstack/eslint-plugin-query'
import pluginReact from 'eslint-plugin-react'
import pluginReactHooks from 'eslint-plugin-react-hooks'
import pluginReactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
	// Global ignores
	{
		ignores: ['dist/**', 'dist-app-auth/**'],
	},

	// Base JS recommended rules
	js.configs.recommended,

	// TypeScript recommended rules
	...tseslint.configs.recommended,

	// TanStack Query recommended rules
	...pluginQuery.configs['flat/recommended'],

	// Main config for all JS/TS files
	{
		files: ['**/*.{js,jsx,ts,tsx}'],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.es2020,
			},
		},
		plugins: {
			react: pluginReact,
			'react-hooks': pluginReactHooks,
			'react-refresh': pluginReactRefresh,
		},
		settings: {
			react: {version: '19'},
		},
		rules: {
			'react/jsx-key': 'error',
			// Prettier configured to use tabs, which means smart tabs. We don't manually indent anyways
			'no-mixed-spaces-and-tabs': 'off',
			// Ignore even if it's true that it catches problems fast refresh
			'react-refresh/only-export-components': ['off', {allowConstantExport: true}],
			// https://github.com/prettier/prettier/issues/2800
			// Prettier will remove extra semi-colons anyways. Prevent error when prettier puts a semicolon before an IIFE
			'no-extra-semi': 'off',
			// shadcn ui sometimes takes an unused `children` prop so it's not spread into an element that shouldn't take children
			'@typescript-eslint/no-unused-vars': 'warn',
			// Allow any
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
]
