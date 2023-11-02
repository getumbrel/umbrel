module.exports = {
	root: true,
	env: {browser: true, es2020: true},
	extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:react-hooks/recommended'],
	ignorePatterns: ['dist', '.eslintrc.cjs'],
	parser: '@typescript-eslint/parser',
	settings: {react: {version: '18.2'}},
	plugins: ['react', 'react-refresh', '@tanstack/query'],
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
	},
}
