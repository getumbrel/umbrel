// Fonts for drawing cells: a workbook's faces with Office's stand-ins
// (shared/fonts), so text fits its columns as it does in Excel, and cached
// measurements, since measuring text is most of the cost of drawing it.

import {fontStack} from '@/features/files/components/file-viewer/shared/fonts'
import type {Font} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/styles'

export const APP_FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

// A cell font as canvas takes it; sizes are points, drawn at 96 dpi like Excel
export function cellFont(font: Partial<Font> & Pick<Font, 'name' | 'size'>): string {
	const px = Math.round(((font.size * 4) / 3) * 100) / 100
	return `${font.italic ? 'italic ' : ''}${font.bold ? 'bold ' : ''}${px}px ${fontStack([font.name])}`
}

// The faces a workbook's fonts use (Umbrel's own Carlito and Caladea among
// them), loaded before its cells are first drawn: a canvas draws with whatever
// is there, and never redraws by itself. Which faces a font needs doesn't
// depend on its size.
export async function loadFonts(fonts: Iterable<Font>): Promise<void> {
	if (!('fonts' in document)) return
	const faces = new Set(Array.from(fonts, (font) => cellFont({...font, size: 12})))
	await Promise.race([
		Promise.all([...faces].map((face) => document.fonts.load(face).catch(() => []))),
		// For a moment at most: the grid redraws when a late face arrives
		new Promise((resolve) => setTimeout(resolve, 1500)),
	])
}

const widths = new Map<string, Map<string, number>>()
const metrics = new Map<string, {ascent: number; descent: number}>()
let measured = 0

// What was measured before a face arrived was measured in another one
if (typeof document !== 'undefined' && 'fonts' in document) {
	document.fonts.addEventListener('loadingdone', () => {
		widths.clear()
		metrics.clear()
	})
}

// Text is measured on a canvas in the page: one outside it doesn't see the
// faces the page loaded (Chrome measures it in a fallback)
let context: CanvasRenderingContext2D | null | undefined
function measuring() {
	if (context === undefined) {
		const canvas = document.createElement('canvas')
		canvas.setAttribute('aria-hidden', 'true')
		canvas.style.cssText = 'position:fixed;width:0;height:0;visibility:hidden;pointer-events:none'
		document.body.append(canvas)
		context = canvas.getContext('2d')
	}
	return context
}

// The width of text in a font, remembered
export function measure(font: string, text: string): number {
	let byText = widths.get(font)
	let width = byText?.get(text)
	if (width !== undefined) return width
	const context = measuring()
	if (!context) return text.length * 7
	context.font = font
	width = context.measureText(text).width
	// A cache that's grown past its use (scrolling through a big file) starts again
	if (++measured > 50_000) {
		widths.clear()
		measured = 1
		byText = undefined
	}
	if (!byText) widths.set(font, (byText = new Map()))
	byText.set(text, width)
	return width
}

// How far a font reaches above and below its baseline
export function fontMetrics(font: string, px: number): {ascent: number; descent: number} {
	let found = metrics.get(font)
	if (!found) {
		const context = measuring()
		if (context) context.font = font
		const sample = context?.measureText('Hg')
		found = {
			ascent: sample?.fontBoundingBoxAscent ?? px * 0.8,
			descent: sample?.fontBoundingBoxDescent ?? px * 0.22,
		}
		// A file can name a face for every rich text run: past far more than one screen draws, the cache starts again
		if (metrics.size >= 10_000) metrics.clear()
		metrics.set(font, found)
	}
	return found
}
