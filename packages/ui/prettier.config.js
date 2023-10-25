/**
 * @type {import('prettier').Config & import("@ianvs/prettier-plugin-sort-imports").PluginConfig}
 */
export default {
	printWidth: 120,
	semi: false,
	useTabs: true,
	trailingComma: 'all', // better for git diffs
	singleQuote: true,
	bracketSpacing: false,
	jsxSingleQuote: true,
	plugins: [
		'@ianvs/prettier-plugin-sort-imports',
		'prettier-plugin-css-order',
		'prettier-plugin-style-order',
		'prettier-plugin-tailwindcss', // must come last
	],
	// Empty string to separate groups
	importOrder: ['<THIRD_PARTY_MODULES>', '', '^@/', '', '^[../]', '^[./]'],
	importOrderParserPlugins: ['typescript', 'jsx'],
	importOrderTypeScriptVersion: '4.4.0',
}
