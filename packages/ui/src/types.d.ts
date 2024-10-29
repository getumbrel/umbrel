// Add types for `import.meta.env`
/// <reference types="vite/client" />

// https://github.com/lokesh/color-thief/issues/188#issuecomment-1166887824
declare module 'colorthief' {
	export type RGBColor = [number, number, number]
	export default class ColorThief {
		getColor: (
			/** The HTML image element. */
			img: HTMLImageElement | null,
			/** The quality level (default: 10). */
			quality?: number,
		) => RGBColor | null
		getPalette: (
			/** The HTML image element. */
			img: HTMLImageElement | null,
			/** The number of colors in the palette (default: 10). */
			colorCount?: number,
			/** The quality level (default: 10). */
			quality?: number,
		) => RGBColor[] | null
	}
}
