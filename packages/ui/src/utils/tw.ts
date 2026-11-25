/** Pairs with `.vscode/settings.json` to provide intellisense for tailwind classes:
 * ```json
 * "tailwindCSS.experimental.classRegex": [
 *     "tw`([^`]*)`"
 * ]
 * ```
 */
export const tw = (strings: TemplateStringsArray) => strings.join('')

// Tailwind's breakpoints, and which of them the window is at (see layout.ts)
export {screens, useBreakpoint} from './layout'
