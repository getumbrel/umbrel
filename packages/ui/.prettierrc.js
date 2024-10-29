import baseConfig from '../../.prettierrc.js'

/**
 * @type {import('prettier').Config & import("@ianvs/prettier-plugin-sort-imports").PluginConfig}
 */
export default {
	...baseConfig,
	plugins: [
		...(baseConfig.plugins || []),
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
