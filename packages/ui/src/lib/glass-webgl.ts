// WebGL lens for Glass surfaces on browsers that can't refract the real
// backdrop (Safari/Firefox don't render backdrop-filter: url()). Where the
// backdrop is something we render ourselves — the desktop wallpaper <img> —
// the fragment shader computes the same rounded-rect SDF + Snell's-law dome
// bend as glass.tsx's displacement map, sampling the wallpaper texture per
// color channel for the chromatic fringe.

export type GlassLensParams = {
	scale: number
	chroma: number
	/** Rim width: fraction of the half min-dimension, or absolute '12px'. */
	bevel: number | string
	saturate: number
	brightness: number
	blur: number
}

/** Resolves a bevel prop to px for a w×h element (min 2px, like the map). */
export function resolveBevelPx(bevel: number | string, w: number, h: number): number {
	const px = typeof bevel === 'string' ? parseFloat(bevel) || 0 : bevel * (Math.min(w, h) / 2)
	return Math.max(2, px)
}

type LensSource = HTMLImageElement | HTMLVideoElement

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uRadius;
uniform float uBevel;
uniform float uScale;
uniform float uChroma;
uniform float uSaturate;
uniform float uBrightness;
uniform float uBlur;
uniform vec2 uUvOff;
uniform vec2 uUvStep;

const float IOR = 1.5;

vec2 lensDisp(vec2 p) {
  vec2 hs = uSize * 0.5;
  vec2 c = p - hs;
  vec2 q = abs(c) - (hs - vec2(uRadius));
  vec2 o = max(q, vec2(0.0));
  float sdf = length(o) + min(max(q.x, q.y), 0.0) - uRadius;
  if (sdf > 0.0 || -sdf > uBevel) return vec2(0.0);
  vec2 n;
  if (q.x > 0.0 && q.y > 0.0) {
    n = (o / max(length(o), 1e-4)) * sign(c);
  } else if (q.x > q.y) {
    n = vec2(sign(c.x), 0.0);
  } else {
    n = vec2(0.0, sign(c.y));
  }
  float u = -sdf / uBevel;
  float maxBend = cos(asin(1.0 / IOR));
  float bend = 1.0;
  if (u > 1e-4) {
    float slope = pow(1.0 - u, 3.0) / pow(1.0 - pow(1.0 - u, 4.0), 0.75);
    float thetaI = atan(slope);
    bend = sin(thetaI - asin(sin(thetaI) / IOR)) / maxBend;
  }
  return n * bend;
}

vec3 sampleGlass(vec2 p) {
  vec2 d = lensDisp(p);
  vec3 col;
  col.r = texture2D(uTex, uUvOff + (p + d * uScale * (1.0 + uChroma)) * uUvStep).r;
  col.g = texture2D(uTex, uUvOff + (p + d * uScale) * uUvStep).g;
  col.b = texture2D(uTex, uUvOff + (p + d * uScale * (1.0 - uChroma)) * uUvStep).b;
  return col;
}

void main() {
  vec2 p = vUv * uSize;
  vec3 col = sampleGlass(p);
  if (uBlur > 0.0) {
    float b = uBlur * 0.8;
    col = (col * 2.0
      + sampleGlass(p + vec2(b, b))
      + sampleGlass(p + vec2(-b, b))
      + sampleGlass(p + vec2(b, -b))
      + sampleGlass(p + vec2(-b, -b))) / 6.0;
  }
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturate) * uBrightness;
  gl_FragColor = vec4(col, 1.0);
}`

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
	const shader = gl.createShader(type)
	if (!shader) return null
	gl.shaderSource(shader, src)
	gl.compileShader(shader)
	return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
}

function sourceSize(source: LensSource): {w: number; h: number} {
	return source instanceof HTMLVideoElement
		? {w: source.videoWidth, h: source.videoHeight}
		: {w: source.naturalWidth, h: source.naturalHeight}
}

function sourceReady(source: LensSource): boolean {
	return source instanceof HTMLVideoElement
		? source.readyState >= 2 && !!source.videoWidth
		: source.complete && !!source.naturalWidth
}

function sourceUrl(source: LensSource): string {
	return source.currentSrc || source.src
}

type Rect = {left: number; top: number; width: number; height: number}

/**
 * The canvas's viewport rect without its host's own transform: the host's
 * layout offset inside its parent, placed at the parent's live rect so page
 * scrolling and ancestor transforms still count. Falls back to the transformed
 * rect where the offsets can't be related (e.g. a fixed host).
 */
function untransformedRect(canvas: HTMLCanvasElement): Rect {
	const host = canvas.offsetParent
	const parent = host?.parentElement
	if (!(host instanceof HTMLElement) || !parent) return canvas.getBoundingClientRect()
	const parentRect = parent.getBoundingClientRect()
	let left: number
	let top: number
	if (host.offsetParent === parent) {
		left = parentRect.left + parent.clientLeft + host.offsetLeft
		top = parentRect.top + parent.clientTop + host.offsetTop
	} else if (host.offsetParent === parent.offsetParent) {
		left = parentRect.left + host.offsetLeft - parent.offsetLeft
		top = parentRect.top + host.offsetTop - parent.offsetTop
	} else {
		return canvas.getBoundingClientRect()
	}
	return {
		left: left - parent.scrollLeft + host.clientLeft + canvas.offsetLeft,
		top: top - parent.scrollTop + host.clientTop + canvas.offsetTop,
		width: canvas.offsetWidth,
		height: canvas.offsetHeight,
	}
}

/**
 * Drives `canvas` as a refraction lens over `getSource()` (the object-fit:
 * cover wallpaper <img>, or a <video>). Alignment is read from live bounding
 * rects each frame, so magnification/hover transforms stay in sync; frames
 * where nothing changed skip the draw, and image textures upload only when
 * the src changes. `onFirstFrame` fires after the first successful draw (use
 * it to reveal the canvas — an alpha:false context is opaque before then).
 * Returns a cleanup function, or null if WebGL is unavailable.
 *
 * `getParams` is read every frame (not captured at attach time) so lens
 * params can change live without tearing down and re-uploading the texture;
 * the param values feed the dirty-check state below, so a param change
 * repaints a static backdrop.
 *
 * With `followHostTransform: false` the lens is aimed from the host's laid-out
 * box instead, ignoring the host's own transform (a hover scale or tilt): the
 * resting view rides along with the card rather than being redrawn every frame.
 */
export function attachBackdropLens(
	canvas: HTMLCanvasElement,
	getSource: () => LensSource | null,
	getParams: () => GlassLensParams,
	onFirstFrame?: () => void,
	onContextLost?: () => void,
	{followHostTransform = true}: {followHostTransform?: boolean} = {},
): (() => void) | null {
	const gl = canvas.getContext('webgl', {antialias: false, alpha: false})
	if (!gl) return null

	// All GL objects live in `let`s so they can be rebuilt wholesale after a
	// context restore — a lost context invalidates every one of them.
	let vs: WebGLShader | null = null
	let fs: WebGLShader | null = null
	let program: WebGLProgram | null = null
	let quad: WebGLBuffer | null = null
	let tex: WebGLTexture | null = null
	let uSize: WebGLUniformLocation | null = null
	let uRadius: WebGLUniformLocation | null = null
	let uBevel: WebGLUniformLocation | null = null
	let uScale: WebGLUniformLocation | null = null
	let uChroma: WebGLUniformLocation | null = null
	let uSaturate: WebGLUniformLocation | null = null
	let uBrightness: WebGLUniformLocation | null = null
	let uBlur: WebGLUniformLocation | null = null
	let uUvOff: WebGLUniformLocation | null = null
	let uUvStep: WebGLUniformLocation | null = null

	let raf = 0
	let uploadedSrc: string | null = null
	let lastState = ''
	let drawn = false

	// A video is re-uploaded only when it presents a new frame, not on every
	// display refresh: a 30fps wallpaper on a 144Hz screen would otherwise be
	// copied to the GPU almost five times per frame it shows, and a paused one
	// every refresh. Without requestVideoFrameCallback every refresh redraws.
	let watchedVideo: HTMLVideoElement | null = null
	let videoFrameCallback = 0
	let videoFrameDirty = true
	function onVideoFrame() {
		videoFrameDirty = true
		if (watchedVideo) videoFrameCallback = watchedVideo.requestVideoFrameCallback(onVideoFrame)
	}
	function watchVideo(video: HTMLVideoElement | null) {
		if (video === watchedVideo) return
		if (watchedVideo) watchedVideo.cancelVideoFrameCallback(videoFrameCallback)
		watchedVideo = video && 'requestVideoFrameCallback' in video ? video : null
		videoFrameDirty = true
		if (watchedVideo) videoFrameCallback = watchedVideo.requestVideoFrameCallback(onVideoFrame)
	}

	function init(): boolean {
		vs = compile(gl!, gl!.VERTEX_SHADER, VERT)
		fs = compile(gl!, gl!.FRAGMENT_SHADER, FRAG)
		program = gl!.createProgram()
		if (!vs || !fs || !program) return false
		gl!.attachShader(program, vs)
		gl!.attachShader(program, fs)
		gl!.linkProgram(program)
		if (!gl!.getProgramParameter(program, gl!.LINK_STATUS)) return false
		gl!.useProgram(program)

		quad = gl!.createBuffer()
		gl!.bindBuffer(gl!.ARRAY_BUFFER, quad)
		gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl!.STATIC_DRAW)
		const aPos = gl!.getAttribLocation(program, 'aPos')
		gl!.enableVertexAttribArray(aPos)
		gl!.vertexAttribPointer(aPos, 2, gl!.FLOAT, false, 0, 0)

		tex = gl!.createTexture()
		gl!.bindTexture(gl!.TEXTURE_2D, tex)
		gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
		gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
		gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
		gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)

		const u = (name: string) => gl!.getUniformLocation(program!, name)
		uSize = u('uSize')
		uRadius = u('uRadius')
		uBevel = u('uBevel')
		uScale = u('uScale')
		uChroma = u('uChroma')
		uSaturate = u('uSaturate')
		uBrightness = u('uBrightness')
		uBlur = u('uBlur')
		uUvOff = u('uUvOff')
		uUvStep = u('uUvStep')

		// Force a texture re-upload and a full redraw on the fresh context
		uploadedSrc = null
		lastState = ''
		drawn = false
		return true
	}
	if (!init()) return null

	// border-radius: inherit resolves through computed style; % clamps below.
	const radiusRaw = getComputedStyle(canvas).borderRadius

	function frame() {
		raf = requestAnimationFrame(frame)
		if (gl!.isContextLost()) return
		const source = getSource()
		if (!source || !sourceReady(source)) return
		const cw = canvas.offsetWidth
		const ch = canvas.offsetHeight
		if (cw < 2 || ch < 2) return

		const isVideo = source instanceof HTMLVideoElement
		const params = getParams()
		const crect = followHostTransform ? canvas.getBoundingClientRect() : untransformedRect(canvas)
		const vrect = source.getBoundingClientRect()
		const state = [
			sourceUrl(source),
			cw,
			ch,
			crect.left,
			crect.top,
			crect.width,
			crect.height,
			vrect.left,
			vrect.top,
			vrect.width,
			vrect.height,
			// Live params feed the dirty-check so tuning a knob repaints a static backdrop
			params.scale,
			params.chroma,
			params.bevel,
			params.saturate,
			params.brightness,
			params.blur,
		].join()
		watchVideo(isVideo ? source : null)
		const newVideoFrame = isVideo && (!watchedVideo || videoFrameDirty)
		// Static backdrop and static geometry — nothing to redraw
		if (!newVideoFrame && drawn && state === lastState) return
		lastState = state

		const dpr = Math.min(window.devicePixelRatio || 1, 2)
		const bw = Math.round(cw * dpr)
		const bh = Math.round(ch * dpr)
		if (canvas.width !== bw || canvas.height !== bh) {
			canvas.width = bw
			canvas.height = bh
		}
		gl!.viewport(0, 0, bw, bh)
		// Videos upload per new frame; images only when the src swaps
		const currentSourceUrl = sourceUrl(source)
		if (newVideoFrame || uploadedSrc !== currentSourceUrl) {
			gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, source)
			uploadedSrc = currentSourceUrl
			videoFrameDirty = false
		}

		// Map lens css px → texture UV, honoring object-fit: cover cropping.
		const {w: iw, h: ih} = sourceSize(source)
		const s = Math.max(vrect.width / iw, vrect.height / ih)
		const ox = vrect.left + (vrect.width - iw * s) / 2
		const oy = vrect.top + (vrect.height - ih * s) / 2

		const rv = parseFloat(radiusRaw) || 0
		const radius = Math.min(radiusRaw.includes('%') ? (Math.min(cw, ch) * rv) / 100 : rv, cw / 2, ch / 2)

		gl!.uniform2f(uSize, cw, ch)
		gl!.uniform1f(uRadius, radius)
		gl!.uniform1f(uBevel, resolveBevelPx(params.bevel, cw, ch))
		gl!.uniform1f(uScale, params.scale)
		gl!.uniform1f(uChroma, params.chroma)
		gl!.uniform1f(uSaturate, params.saturate)
		gl!.uniform1f(uBrightness, params.brightness)
		gl!.uniform1f(uBlur, params.blur)
		gl!.uniform2f(uUvOff, (crect.left - ox) / (s * iw), (crect.top - oy) / (s * ih))
		gl!.uniform2f(uUvStep, crect.width / cw / (s * iw), crect.height / ch / (s * ih))
		gl!.drawArrays(gl!.TRIANGLES, 0, 3)
		if (!drawn) {
			drawn = true
			onFirstFrame?.()
		}
	}

	function start() {
		if (!raf) raf = requestAnimationFrame(frame)
	}
	function stop() {
		if (raf) cancelAnimationFrame(raf)
		raf = 0
	}

	let visible = false
	const io = new IntersectionObserver((entries) => {
		visible = Boolean(entries[0]?.isIntersecting)
		if (visible) start()
		else stop()
	})
	io.observe(canvas)

	// The browser evicts the oldest WebGL contexts past its per-page cap (~16 in
	// Chromium) — e.g. with many glass widgets mounted at once. preventDefault
	// signals we can recover, and the browser fires webglcontextrestored once
	// pressure drops (say, a sheet full of example widgets unmounts); rebuild
	// the GL state and repaint. Without this the canvas is dead for good and
	// Chromium paints its sad-face placeholder over the widget.
	const handleContextLost = (event: Event) => {
		event.preventDefault()
		stop()
		onContextLost?.()
	}
	const handleContextRestored = () => {
		// An off-screen lens stays parked; the observer starts it when it scrolls in
		if (init() && visible) start()
	}
	canvas.addEventListener('webglcontextlost', handleContextLost)
	canvas.addEventListener('webglcontextrestored', handleContextRestored)

	return () => {
		stop()
		watchVideo(null)
		io.disconnect()
		canvas.removeEventListener('webglcontextlost', handleContextLost)
		canvas.removeEventListener('webglcontextrestored', handleContextRestored)
		gl.deleteTexture(tex)
		gl.deleteBuffer(quad)
		gl.deleteProgram(program)
		gl.deleteShader(vs)
		gl.deleteShader(fs)
	}
}
