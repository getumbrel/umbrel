// The tiles, as one WebGL2 draw call.
//
// A canvas the height of a band rather than of the whole content, absolutely
// positioned inside the scroller, so ordinary scrolling moves it on the
// compositor for free and this only redraws when the band itself has to move.
// Every tile is one instance of a unit quad: the vertex shader places it and
// works out which cell of the atlas it samples, and the fragment shader draws
// the rounded corner, the hover wash, a video's play badge, the line of a
// moment a search matched and the selection ring as SDFs, which on a GPU is the same fragment either way. Ten thousand tiles is one buffer
// upload and one `drawArraysInstanced` — a fifth of a millisecond — which is
// why the cost here is the size of the screen and not the number of photos.
//
// It never runs a loop of its own. `draw` is called on a committed view, on a
// band-edge scroll, on a hover or a selection change, and on every frame of a
// live gesture; it returns whether anything is still fading, and the caller
// asks for another frame if so. A canvas that redraws what did not change
// costs a fifth of a core even when it is drawing nothing new.

import {Atlas, compile} from '@/features/photos/components/listing/gpu/atlas'
import {bandFor, cellForBand, GPU_OVERSCAN, type AtlasPlan} from '@/features/photos/components/listing/gpu/capability'
import {rectOf, tileRadius, type Layout} from '@/features/photos/components/listing/timeline-rows'
import {momentFraction} from '@/features/search/scrubber'

// Tint → photograph, ease-out. Never while a gesture is live (a fade over a
// moving grid reads as flicker), never when a photo replaces a coarser
// version of itself — that is a sharpening, and it should be instant — and
// never in the canvas's first moments (WARM_MS below).
const FADE_MS = 180
// A canvas this young is filling in after the seam crossing or a remount:
// what arrives now was on screen a breath ago — the DOM tiles nearest the
// seam draw the same 192 rendition, so the fetches are cache hits — and
// fading it in from tint would read as the grid flashing. Past this, an
// arrival is a genuine arrival and gets its fade.
const WARM_MS = 800
// Uploads are the one main-thread cost in the pipeline that can drop a frame.
// While a gesture owns the grid they are strictly rationed — four cells is a
// few tenths of a millisecond at 32px and a couple of milliseconds at 256px —
// but a settled frame spends a measured slice instead: a warm seam crossing
// delivers a bandful in one burst, and four a frame would hold the mosaic in
// tint for a second while the pixels sat decoded in the queue.
const UPLOAD_PER_FRAME_LIVE = 4
const UPLOAD_BUDGET_MS = 3
// Floats per instance: x, y, size, radius | slot, tint, flags, fade
// (flags is a bitfield: selected 1, hovered 2, video 4; above it, from 8 up,
// how far into a video a search matched, in thousandths plus one — see
// momentFlag)
const STRIDE = 8
// A cell with no colour of its own yet, matching the DOM tile's `bg-white/6`
const NO_TINT = -1

const VERTEX = `#version 300 es
in vec4 aRect;
in vec4 aStyle;
uniform vec2 uViewport;
uniform float uSide;
uniform float uCell;
out vec2 vLocal;
out float vHalf;
out float vRadius;
out vec3 vUvw;
out vec3 vTint;
out float vAlpha;
out float vFade;
out float vSelected;
out float vHovered;
out vec4 vBadge;
out vec2 vMoment;

void main() {
	vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
	gl_Position = vec4(((aRect.xy + corner * aRect.z) / uViewport) * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
	vHalf = aRect.z * 0.5;
	vLocal = (corner - 0.5) * aRect.z;
	vRadius = aRect.w;

	float slot = aStyle.x;
	if (slot < 0.0) {
		vUvw = vec3(0.0);
		vFade = 0.0;
	} else {
		float perRow = floor(uSide / uCell);
		float perLayer = perRow * perRow;
		float layer = floor(slot / perLayer);
		vec2 cell = vec2(mod(slot - layer * perLayer, perRow), floor((slot - layer * perLayer) / perRow)) * uCell;
		// Half a texel in from each edge, so bilinear can never reach a neighbour
		vUvw = vec3((cell + 0.5 + corner * (uCell - 1.0)) / uSide, layer);
		vFade = aStyle.w;
	}

	float tint = aStyle.y;
	vAlpha = tint < 0.0 ? 0.06 : 1.0;
	vTint = tint < 0.0
		? vec3(1.0)
		: vec3(floor(tint / 65536.0), floor(mod(tint, 65536.0) / 256.0), mod(tint, 256.0)) / 255.0;

	float flags = aStyle.z;
	vSelected = mod(flags, 2.0);
	vHovered = mod(floor(flags / 2.0), 2.0);

	// The play badge a video's tile wears, like the DOM tiles' bottom-left
	// mark: centre and radius in the tile's own px, and how present it is at
	// rest — scaled to the tile and pinned to a legible size, easing out
	// below ~26px of tile where a mark on every video would read as noise
	// (the fragment still shows it under the pointer). w is −1 on a photo.
	float video = mod(floor(flags / 4.0), 2.0);
	float badgeRadius = clamp(aRect.z * 0.12, 4.5, 8.0);
	float badgeInset = clamp(aRect.z * 0.085, 2.0, 4.0) + badgeRadius;
	vBadge = video < 0.5
		? vec4(0.0, 0.0, 0.0, -1.0)
		: vec4(badgeInset - vHalf, vHalf - badgeInset, badgeRadius, smoothstep(18.0, 26.0, aRect.z));

	// The moment a search matched in this video, as the DOM tiles draw it (see
	// MomentScrubber): a line along the bottom edge, filled up to the moment.
	// x is how far along, −1 on a tile with none; y the line's height, which
	// follows the tile down to a hairline. The play badge sits clear of it.
	float moment = floor(flags / 8.0);
	float line = clamp(aRect.z * 0.045, 1.5, 3.0);
	vMoment = moment < 0.5 ? vec2(-1.0, 0.0) : vec2((moment - 1.0) / 1000.0, line);
	if (moment >= 0.5) vBadge.y -= line;
}`

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vLocal;
in float vHalf;
in float vRadius;
in vec3 vUvw;
in vec3 vTint;
in float vAlpha;
in float vFade;
in float vSelected;
in float vHovered;
in vec4 vBadge;
in vec2 vMoment;
uniform sampler2DArray uAtlas;
uniform vec3 uBrand;
uniform vec3 uMatch;
uniform float uPixel;
out vec4 outColor;

float roundedBox(vec2 p, float halfSize, float radius) {
	vec2 q = abs(p) - halfSize + radius;
	return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

void main() {
	float d = roundedBox(vLocal, vHalf, min(vRadius, vHalf));
	// Antialiased over one device pixel, so the corner is resolution correct
	// at every zoom
	float inside = 1.0 - smoothstep(-uPixel, uPixel, d);
	if (inside <= 0.0) discard;

	vec3 color = mix(vTint, texture(uAtlas, vUvw).rgb, vFade);
	color += vHovered * 0.08;
	float base = max(vAlpha, vFade);
	vec4 shaded = vec4(color * base, base);

	// A video's play badge — the DOM tiles' black-scrim circle and white
	// glyph, as SDFs, composited over (premultiplied) so it holds its own
	// even on the translucent placeholder tint. Present at rest where it
	// reads (vBadge.w); under the pointer regardless, as an affordance.
	float badge = vBadge.w < 0.0 ? 0.0 : max(vBadge.w, vHovered);
	if (badge > 0.0) {
		vec2 p = vLocal - vBadge.xy;
		float R = vBadge.z;
		float scrim = 1.0 - smoothstep(-uPixel, uPixel, length(p) - R);
		// A rightward triangle, symmetric over |y|, nudged right of centre
		// the way a play glyph is optically centred
		vec2 q = vec2(p.x - 0.08 * R, abs(p.y));
		float slant = dot(q - vec2(0.46 * R, 0.0), normalize(vec2(0.46, 0.74)));
		float glyph = 1.0 - smoothstep(-uPixel, uPixel, max(-q.x - 0.28 * R, slant));
		shaded = mix(shaded, vec4(0.0, 0.0, 0.0, 1.0), 0.55 * scrim * badge);
		shaded = mix(shaded, vec4(1.0), glyph * badge);
	}

	// The matched moment's line: a scrim of track, the match colour up to the moment
	if (vMoment.x >= 0.0) {
		float on = 1.0 - smoothstep(vMoment.y - uPixel, vMoment.y + uPixel, vHalf - vLocal.y);
		float along = (vLocal.x + vHalf) / (2.0 * vHalf);
		float played = 1.0 - smoothstep(-uPixel, uPixel, (along - vMoment.x) * 2.0 * vHalf - 1.5);
		vec4 track = mix(mix(shaded, vec4(0.0, 0.0, 0.0, 1.0), 0.35), vec4(1.0), 0.35);
		shaded = mix(shaded, mix(track, vec4(uMatch, 1.0), played), on);
	}

	// The ring follows the tile: two device pixels of brand on a fourteen
	// pixel tile would be a quarter of the photograph
	float ring = max(1.0, vHalf * 0.16);
	float within = 1.0 - smoothstep(-ring - uPixel, -ring + uPixel, d);
	shaded = mix(shaded, vec4(uBrand, 1.0), vSelected * (1.0 - within));

	outColor = shaded * inside;
}`

// A matched moment's place in a video as the bits of `flags` above the three
// states: thousandths of the way through plus one, times eight — zero, and so
// no line, where there is no moment or no length to place it by. Whole
// numbers up to 8008, which a float carries exactly.
export function momentFlag(momentMs: number | undefined, durationMs: number | undefined) {
	if (momentMs === undefined) return 0
	const fraction = momentFraction(momentMs, durationMs)
	return fraction === undefined ? 0 : (Math.round(fraction * 1000) + 1) * 8
}

// One frame of the grid, in the scroller's own coordinates. Everything here
// is derived from the layout, the item list and the selection, so a frame can
// be thrown away and rebuilt at any time and the canvas and the DOM path
// cannot drift.
export type Frame = {
	layout: Layout
	items: {start: number; end: number}
	scrollTop: number
	viewport: {width: number; height: number}
	selected: ReadonlySet<string>
	hovered: string | undefined
	// The item whose picture the lightbox has in the air: its cell is left out
	// of the frame, so the place it left is empty (see tile-lift.ts)
	lifted: string | undefined
	// Videos a search matched at a moment, by id: each wears a line filled up
	// to it
	moments: ReadonlyMap<string, {startMs: number}> | undefined
	// Where the eye is, in the scroller's viewport px, when a pointer or a
	// pinch's midpoint set it: what the pixels fill outward from
	focal: {x: number; y: number} | null
	// A gesture owns the zoom: nothing re-tiers and nothing fades while the
	// grid is moving under a finger
	settled: boolean
	// Reduced motion: pixels are applied instantly
	animate: boolean
}

export type TileRenderer = NonNullable<ReturnType<typeof createRenderer>>

export function createRenderer(canvas: HTMLCanvasElement, plan: AtlasPlan, cell: number) {
	const gl = canvas.getContext('webgl2', {
		alpha: true,
		antialias: false,
		depth: false,
		stencil: false,
		premultipliedAlpha: true,
		powerPreference: 'low-power',
	})
	if (!gl) return null
	const program = compile(gl, VERTEX, FRAGMENT)
	if (!program) return null

	const atlas = new Atlas(gl, plan, cell)
	// When this canvas came to be, for the warm window above
	const born = performance.now()
	const buffer = gl.createBuffer()!
	const vao = gl.createVertexArray()!
	gl.bindVertexArray(vao)
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
	for (const [name, offset] of [
		['aRect', 0],
		['aStyle', 16],
	] as const) {
		const location = gl.getAttribLocation(program, name)
		gl.enableVertexAttribArray(location)
		gl.vertexAttribPointer(location, 4, gl.FLOAT, false, STRIDE * 4, offset)
		gl.vertexAttribDivisor(location, 1)
	}
	gl.bindVertexArray(null)

	const uniform = (name: string) => gl.getUniformLocation(program, name)
	const uViewport = uniform('uViewport')
	const uSide = uniform('uSide')
	const uCell = uniform('uCell')
	const uAtlas = uniform('uAtlas')
	const uBrand = uniform('uBrand')
	const uMatch = uniform('uMatch')
	// The colour of a search's match, as the page defines it (--color-match)
	const match = hslTriplet(getComputedStyle(document.documentElement).getPropertyValue('--color-match')) ?? [
		1, 0.84, 0.04,
	]
	const uPixel = uniform('uPixel')

	let instances = new Float32Array(1024 * STRIDE)
	// When each cell's photograph arrived, for the fade; zero means "always
	// been there", which is what a re-tiered cell and a coarse-to-fine swap
	// both want
	let arrivedAt = new Float64Array(atlas.slots)
	const waiting = new Map<string, {index: number; bitmap: ImageBitmap}>()
	let brand: [number, number, number] = [0.29, 0.16, 0.98]
	// Where the canvas sits inside the scroller's content
	let band = {top: 0, height: 0}
	let size = {width: 0, height: 0, dpr: 0}

	function readBrand() {
		// The brand colour follows the wallpaper, so it is read from the
		// element rather than baked in
		const match = /(\d+)\D+(\d+)\D+(\d+)/.exec(getComputedStyle(canvas).color)
		if (match) brand = [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255]
	}
	readBrand()

	function place(frame: Frame) {
		const {height} = bandFor(frame.viewport)
		const overscan = frame.viewport.height * GPU_OVERSCAN
		const limit = Math.max(0, frame.layout.total - height)
		const wanted = Math.min(limit, Math.max(0, frame.scrollTop - overscan))
		// Between moves the band scrolls with the content on the compositor;
		// it is only pulled along when the viewport comes near an edge
		const near =
			frame.scrollTop - band.top < overscan / 2 ||
			band.top + band.height - (frame.scrollTop + frame.viewport.height) < overscan / 2
		if (band.height !== height || near || !frame.settled) band = {top: wanted, height}
		canvas.style.top = `${band.top}px`
		canvas.style.height = `${band.height}px`

		const dpr = devicePixelRatio || 1
		if (size.width !== frame.viewport.width || size.height !== band.height || size.dpr !== dpr) {
			size = {width: frame.viewport.width, height: band.height, dpr}
			canvas.width = Math.round(size.width * dpr)
			canvas.height = Math.round(size.height * dpr)
		}
		return dpr
	}

	function upload(frame: Frame, now: number, everything = false) {
		const deadline = performance.now() + UPLOAD_BUDGET_MS
		let budget = UPLOAD_PER_FRAME_LIVE
		for (const [id, {index, bitmap}] of waiting) {
			if (!everything && (frame.settled ? performance.now() >= deadline : budget-- <= 0)) break
			waiting.delete(id)
			// Decoded for a cell size the atlas has since left behind: drop it
			// and let the scheduler ask again at the size that is wanted now
			if (bitmap.width === atlas.cell) {
				const slot = atlas.slotOf(index)
				// The same photograph coming back sharper — shown stretched
				// since a re-tier — swaps in place, with no fade
				const sharpening = atlas.resident[slot] === id
				atlas.put(index, id, bitmap)
				arrivedAt[slot] = !sharpening && frame.settled && frame.animate && now - born >= WARM_MS ? now : 0
			}
			bitmap.close()
		}
	}

	function fill(frame: Frame, now: number) {
		const {layout, items, selected, hovered, lifted, moments} = frame
		const count = Math.max(0, items.end - items.start + 1)
		if (instances.length < count * STRIDE) instances = new Float32Array(count * STRIDE * 2)
		let fading = false
		let offset = 0
		for (let index = items.start; index <= items.end; index++) {
			const item = layout.items[index]
			if (!item) break
			if (item.id === lifted) continue
			const rect = rectOf(layout, index)
			const slot = atlas.slotOf(index)
			const resident = atlas.resident[slot] === item.id
			let fade = 0
			if (resident) {
				const since = now - arrivedAt[slot]!
				fade = since >= FADE_MS ? 1 : since / FADE_MS
				if (fade < 1) fading = true
			}
			instances[offset] = rect.x
			instances[offset + 1] = rect.y - band.top
			instances[offset + 2] = rect.size
			// Below the seam the phone's corner and the desktop's are one ramp (see tileGap)
			instances[offset + 3] = tileRadius(rect.size, false)
			instances[offset + 4] = resident ? slot : -1
			instances[offset + 5] = item.tint ?? NO_TINT
			instances[offset + 6] =
				(selected.has(item.id) ? 1 : 0) +
				(hovered === item.id ? 2 : 0) +
				(item.kind === 'video' ? 4 : 0) +
				(moments && item.kind === 'video' ? momentFlag(moments.get(item.id)?.startMs, item.durationMs) : 0)
			instances[offset + 7] = fade
			offset += STRIDE
		}
		return {count: offset / STRIDE, fading}
	}

	return {
		get cell() {
			return atlas.cell
		},
		holds: (index: number, id: string) => atlas.holds(index, id) || waiting.has(id),

		// A decoded thumbnail, uploaded on the next frame so a burst of
		// arrivals cannot stall one
		deliver(index: number, id: string, bitmap: ImageBitmap) {
			waiting.get(id)?.bitmap.close()
			waiting.set(id, {index, bitmap})
		},

		// Draw, and say whether another frame is wanted: something still
		// fading, or photographs still waiting to go up — the upload budget is
		// per frame, and a burst of arrivals must not wait for the next hover
		draw(frame: Frame) {
			const now = performance.now()
			const dpr = place(frame)
			if (frame.settled) {
				readBrand()
				const want = cellForBand(frame.layout.tile, dpr, plan, bandFor(frame.viewport))
				if (want !== atlas.cell) {
					// Everything already decoded for the cell being left goes
					// aboard first, whatever this one frame costs: the re-tier
					// carries it, where dropping it would leave holes that
					// nothing refills at the floor — tiles there are below
					// FETCH_MIN_DEVICE_PX, and the scheduler, rightly, will
					// not spend the network on them. A fast descent can leave
					// a bandful decoded but not yet up; this is the one moment
					// the per-frame budget must not apply to it.
					upload(frame, now, true)
					atlas.retier(want, frame.items, (index) => frame.layout.items[index]?.id)
					arrivedAt = new Float64Array(atlas.slots)
				}
			}
			upload(frame, now)
			const {count, fading} = fill(frame, now)

			gl.viewport(0, 0, canvas.width, canvas.height)
			gl.clearColor(0, 0, 0, 0)
			gl.clear(gl.COLOR_BUFFER_BIT)
			if (count === 0) return waiting.size > 0
			gl.enable(gl.BLEND)
			gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
			gl.useProgram(program)
			gl.bindVertexArray(vao)
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
			gl.bufferData(gl.ARRAY_BUFFER, instances.subarray(0, count * STRIDE), gl.DYNAMIC_DRAW)
			gl.activeTexture(gl.TEXTURE0)
			gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas.texture)
			gl.uniform1i(uAtlas, 0)
			gl.uniform2f(uViewport, size.width, size.height)
			gl.uniform1f(uSide, plan.side)
			gl.uniform1f(uCell, atlas.cell)
			gl.uniform3f(uBrand, brand[0], brand[1], brand[2])
			gl.uniform3f(uMatch, match[0], match[1], match[2])
			gl.uniform1f(uPixel, 1 / dpr)
			gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
			gl.bindVertexArray(null)
			return fading || waiting.size > 0
		},

		dispose() {
			for (const {bitmap} of waiting.values()) bitmap.close()
			waiting.clear()
			atlas.dispose()
			gl.deleteProgram(program)
			gl.deleteBuffer(buffer)
			gl.deleteVertexArray(vao)
			gl.getExtension('WEBGL_lose_context')?.loseContext()
		},
	}
}

// "50 100% 52%", as a colour token is kept in CSS, as red, green and blue 0..1
export function hslTriplet(value: string): [number, number, number] | undefined {
	const parts = /^\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/.exec(value)
	if (!parts) return undefined
	const [h, s, l] = [Number(parts[1]) / 360, Number(parts[2]) / 100, Number(parts[3]) / 100]
	const k = (n: number) => (n + h * 12) % 12
	const a = s * Math.min(l, 1 - l)
	const channel = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
	return [channel(0), channel(8), channel(4)]
}
