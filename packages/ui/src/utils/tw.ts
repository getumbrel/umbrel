import {createBreakpoint} from 'react-use'
import {mapValues} from 'remeda'
import {Config} from 'tailwindcss'
import resolveConfig from 'tailwindcss/resolveConfig'

import tailwindConfig from '../../tailwind.config.ts'

/** Pairs with `.vscode/settings.json` to provide intellisense for tailwind classes:
 * ```json
 * "tailwindCSS.experimental.classRegex": [
 *     "tw`([^`]*)`"
 * ]
 * ```
 */
export const tw = (strings: TemplateStringsArray) => strings.join('')

export const tailwindConfigFull = resolveConfig({
	...tailwindConfig,
	plugins: [],
} as Config)

export const screens = mapValues(
	(tailwindConfigFull.theme?.screens ?? {}) as Record<string, string>,
	(value) => parseInt(value) ?? 0,
)

export const useBreakpoint = createBreakpoint(screens)
