module.exports = {
	root: true,
	env: {browser: true, es2020: true},
	extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:react-hooks/recommended'],
	ignorePatterns: ['dist', '.eslintrc.cjs'],
	parser: '@typescript-eslint/parser',
	settings: {react: {version: '18.2'}},
	plugins: ['react-refresh'],
	rules: {
		'react-refresh/only-export-components': ['warn', {allowConstantExport: true}],
		// https://github.com/prettier/prettier/issues/2800
		// Prettier will remove extra semi-colons anyways
		'no-extra-semi': 'off', // prevent error when prettier puts a semicolon before an IIFE
	},
}
