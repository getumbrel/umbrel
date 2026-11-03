// What this device's GPU can hold, and therefore how far out the grid can go.
//
// The whole canvas design rests on one invariant: the atlas has a slot for
// every item in the band it draws, so `slot = itemIndex mod slotCount` can
// never put two visible items in the same cell — a band is a contiguous run
// of indices. There is then no eviction policy, no LRU, no free list and no
// rectangle packer: `resident[slot] !== id` means "upload it". Everything
// here exists to keep that invariant true, and when even the finest cell
// cannot hold a bandful, it is the zoom floor that moves rather than the
// atlas that overflows.
//
// None of this touches a GL context except `webgl2Limits`, which asks one
// throwaway context for two numbers. That is deliberate: the decisions worth
// getting right are arithmetic, and arithmetic can be tested.

import {tileGap} from '@/features/photos/components/listing/timeline-rows'

export type GpuLimits = {maxTextureSize: number; maxLayers: number}

// The canvas draws a band rather than a viewport, so ordinary scrolling moves
// it on the compositor with no redraw at all; this much of a viewport hangs
// off each end of it.
export const GPU_OVERSCAN = 0.3

export function bandFor(viewport: {width: number; height: number}) {
	return {width: viewport.width, height: viewport.height * (1 + 2 * GPU_OVERSCAN)}
}

// Cell sizes, in device pixels: every power of two and its quarter and half
// steps. A cell is never magnified — the smallest one that covers the tile is
// chosen — and never minified by more than a third, so bilinear filtering is
// correct without mipmaps, which on an atlas would bleed between neighbouring
// cells anyway. The ladder is this fine because its step is squared in the
// atlas: a plain power-of-two ladder would waste four times the texture just
// above each boundary, and that waste comes straight out of the zoom floor.
export const CELLS = [32, 40, 48, 64, 80, 96, 128, 160, 192, 256] as const

export function cellFor(tile: number, dpr: number) {
	const want = tile * dpr
	return CELLS.find((cell) => cell >= want) ?? CELLS[CELLS.length - 1]!
}

export function slotsPerLayer(side: number, cell: number) {
	const perRow = Math.floor(side / cell)
	return perRow * perRow
}

// Items a band of this size holds at this tile — an over-estimate, because it
// ignores the headers that push tiles out of it, which is the right direction
// to be wrong in. The canvas only ever draws below the seam, where a phone's
// gap and the desktop's are the same ramp (neither reaches its cap under a
// 72px tile; see tileGap), so the band is one sum on either.
export function bandItems(band: {width: number; height: number}, tile: number) {
	const pitch = tile + tileGap(tile, false)
	return Math.ceil(band.width / pitch) * (Math.ceil(band.height / pitch) + 1)
}

// The atlas this device can afford: one texture array, `layers` layers of
// `side × side`, and the smallest tile it can hold a bandful of.
export type AtlasPlan = {side: number; layers: number; floor: number}

export const slotCount = (plan: AtlasPlan, cell: number) => plan.layers * slotsPerLayer(plan.side, cell)

const MB = 1024 * 1024
// The resident set for one screenful is the screen's own pixel count,
// whatever the zoom — a cell is sized to the pixels its tile covers, so
// fourteen thousand tiles at 32px and fifty at 256px come to the same texels.
// So the budget derives from the viewport and not from any tile count. Eight
// screenfuls covers the band and the ladder's slack; a re-tier's second array
// is transient and is not budgeted for, because it is freed in the same tick.
const BUDGET_SCREENFULS = 8
const BUDGET_MIN = 64 * MB
const BUDGET_MAX = 192 * MB

// Layers to hold a bandful at every tile from `floor` up to the seam, at the
// cell each of them would ideally use. The worst case is always just above a
// rung of the ladder, where the cell has stepped up but the band has barely
// thinned — which is why the ladder is fine.
function layersFor(band: {width: number; height: number}, dpr: number, side: number, floor: number, seam: number) {
	let layers = 1
	for (let tile = Math.floor(floor); tile <= Math.ceil(seam); tile++) {
		layers = Math.max(layers, Math.ceil(bandItems(band, tile) / slotsPerLayer(side, cellFor(tile, dpr))))
	}
	return layers
}

export function atlasPlan(
	viewport: {width: number; height: number},
	dpr: number,
	limits: GpuLimits,
	bounds: {floor: number; min: number},
): AtlasPlan | null {
	if (viewport.width <= 0 || viewport.height <= 0) return null
	const side = Math.min(2048, limits.maxTextureSize)
	if (side < CELLS[CELLS.length - 1]!) return null
	const budget = Math.min(
		BUDGET_MAX,
		Math.max(BUDGET_MIN, BUDGET_SCREENFULS * viewport.width * viewport.height * dpr * dpr * 4),
	)
	const affordable = Math.min(limits.maxLayers, Math.max(1, Math.floor(budget / (side * side * 4))))
	const band = bandFor(viewport)
	// Take what the ladder asks for, or what the device can afford, whichever
	// is less: the shortfall is spent on slightly softer cells (see
	// `cellForBand`) rather than on an atlas that overflows.
	const layers = Math.min(affordable, layersFor(band, dpr, side, bounds.floor, bounds.min))
	const plan = {side, layers, floor: bounds.floor}
	// … and the floor is wherever a bandful still fits in the finest cell
	// there is. An iPad stops a pixel or two short of where a desktop does;
	// nothing anywhere overflows.
	for (let floor = bounds.floor; floor < bounds.min; floor++) {
		if (slotCount(plan, CELLS[0]!) >= bandItems(band, floor)) return {...plan, floor}
	}
	return null
}

// The cell a tile actually gets: the smallest that covers it, stepped down
// while the atlas cannot hold a bandful of them. On a device that could not
// afford every layer the ladder asked for, that means tiles a hair softer at
// some zooms — never a cell two visible photos have to share.
export function cellForBand(tile: number, dpr: number, plan: AtlasPlan, band: {width: number; height: number}) {
	const want = bandItems(band, tile)
	let rung = CELLS.findIndex((cell) => cell >= tile * dpr)
	if (rung === -1) rung = CELLS.length - 1
	while (rung > 0 && slotCount(plan, CELLS[rung]!) < want) rung--
	return CELLS[rung]!
}

// Where a slot sits in the array, in texels
export function cellAt(slot: number, side: number, cell: number) {
	const perRow = Math.floor(side / cell)
	const perLayer = perRow * perRow
	const inLayer = slot % perLayer
	return {layer: Math.floor(slot / perLayer), x: (inLayer % perRow) * cell, y: Math.floor(inLayer / perRow) * cell}
}

// Which cells survive a change of cell size, and where they move to. The slot
// count changes with the cell, so every cell moves; one holding something the
// band no longer wants is simply left behind. Cheap — one pass over the band
// — and it is what makes zooming out never cost a fetch for a photo already
// on screen.
export function retierMap(
	resident: readonly (string | undefined)[],
	slots: number,
	band: {start: number; end: number},
	idAt: (index: number) => string | undefined,
) {
	const moves: {from: number; to: number; id: string}[] = []
	if (resident.length === 0 || slots === 0) return moves
	for (let index = band.start; index <= band.end; index++) {
		const id = idAt(index)
		if (id === undefined || resident[index % resident.length] !== id) continue
		moves.push({from: index % resident.length, to: index % slots, id})
	}
	return moves
}

// WebGL2, probed once per session. The context is thrown away immediately —
// the canvas that draws takes its own, and there is never more than one alive,
// which is what keeps the browser from silently killing the oldest.
let limits: GpuLimits | null | undefined

export function webgl2Limits(): GpuLimits | null {
	if (limits !== undefined) return limits
	limits = null
	try {
		const canvas = document.createElement('canvas')
		canvas.width = 1
		canvas.height = 1
		const gl = canvas.getContext('webgl2', {
			alpha: true,
			antialias: false,
			depth: false,
			stencil: false,
			powerPreference: 'low-power',
		})
		if (gl) {
			limits = {
				maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
				maxLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number,
			}
			gl.getExtension('WEBGL_lose_context')?.loseContext()
		}
	} catch {
		// A blocked or missing GPU: the grid simply stops where the DOM does
	}
	return limits
}

// A renderer that keeps dying is worse than one that is not there: the first
// loss drops the grid back to the tile sizes elements can draw, and the second
// in the session gives up on WebGL2 altogether. Counted here rather than in the
// grid because the grid is remounted every time the sheet is opened, and a
// context that dies on every visit is exactly the case this is for.
let losses = 0

export function noteContextLoss() {
	if (++losses > 1) limits = null
}
