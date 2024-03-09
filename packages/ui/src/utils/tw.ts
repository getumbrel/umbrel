import {createBreakpoint} from 'react-use'

/** Pairs with `.vscode/settings.json` to provide intellisense for tailwind classes:
 * ```json
 * "tailwindCSS.experimental.classRegex": [
 *     "tw`([^`]*)`"
 * ]
 * ```
 */
export const tw = (strings: TemplateStringsArray) => strings.join('')

export const screens = {
	sm: 640,
	md: 768,
	lg: 1024,
	xl: 1280,
	'2xl': 1400,
}

export const useBreakpoint = createBreakpoint(screens)
