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
		ignores: ['dist/**'],
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
	// Windows draw their own close button, so they're built from the primitives that do
	{
		files: ['src/**/*.{ts,tsx}'],
		ignores: [
			'src/components/ui/alert-dialog.tsx',
			'src/components/ui/command.tsx',
			'src/components/ui/dialog-close-button.tsx',
			'src/components/ui/dialog.tsx',
			'src/components/ui/immersive-dialog.tsx',
			'src/components/ui/sheet.tsx',
			'src/features/files/components/file-viewer/shell/quick-look.tsx',
			'src/features/files/components/file-viewer/shell/viewer-shell.tsx',
			'src/features/files/components/rewind/index.tsx',
			'src/features/photos/components/viewer/item-viewer.tsx',
			'**/*.test.tsx',
		],
		rules: {
			'@typescript-eslint/no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: '@radix-ui/react-dialog',
							message: 'Use the Dialog primitives in components/ui. They own the close button.',
							allowTypeImports: true,
						},
					],
				},
			],
		},
	},
	{
		files: ['src/**/*.tsx'],
		ignores: ['**/*.test.tsx'],
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					selector: "JSXAttribute[name.name='closeButton'] > JSXExpressionContainer > Literal[value=false]",
					message: 'Every window has a close button. Use AlertDialog for a decision, or a condition for a busy state.',
				},
			],
		},
	},
	{
		files: ['scripts/**/*.{js,mjs,cjs}'],
		languageOptions: {
			globals: globals.node,
		},
	},
	{
		files: ['src/modules/app-store/**/*.{js,jsx,ts,tsx}'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['@/features/app-store', '@/features/app-store/**'],
							message: 'Legacy App Store UI must depend on shared hooks/domain code, not the redesigned feature.',
						},
					],
				},
			],
		},
	},
]
