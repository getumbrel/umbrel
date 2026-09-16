import {Mesh, Program, Renderer, Triangle} from 'ogl'

import type {OrbPalette, Rgb} from './orb-palette'

// The search orb: a glossy sphere of slowly swirling wallpaper colour, drawn
// by one fragment shader on a full-canvas triangle. There's no geometry to
// speak of — the sphere is ray-cast per pixel — so a 90px orb costs a few
// thousand fragments a frame and nothing on the CPU. Framework-free so the
// React wrapper stays thin and a test page can drive it directly.

export type OrbRenderer = {
	setPalette: (palette: OrbPalette, instant?: boolean) => void
	setSize: (px: number) => void
	// How agitated the swirl is, 0..1: typing feeds it, it settles on its own
	setEnergy: (energy: number) => void
	// A brief wash of light, on Enter
	pulse: () => void
	start: () => void
	stop: () => void
	// Draw a single frame now, for orbs that stay still
	frame: () => void
	dispose: () => void
}

// Every orb on the page shares one clock, so the small orb in the Home pill
// and the large one above the search card show the same moment of the same
// swirl — what lets one fly into the other's place without a visible cut.
const EPOCH = performance.now()

const ENERGY_ATTACK = 9 // per second
const ENERGY_RELEASE = 1.4
const PULSE_DECAY = 3.2
const PALETTE_BLEND = 5

// The renderer makes its own <canvas> inside `host` and takes it away again
// on dispose. A lost context stays with its canvas (React reuses DOM nodes
// across StrictMode's double mount), so every renderer must start from a new
// one; losing the context on dispose then keeps the browser's context budget
// free for the next.
export function createOrbRenderer(host: HTMLElement, {dpr = 1, seed = 0}: {dpr?: number; seed?: number} = {}) {
	const canvas = document.createElement('canvas')
	canvas.className = 'block size-full rounded-full'
	canvas.setAttribute('aria-hidden', 'true')
	const context = canvas.getContext('webgl', {
		alpha: true,
		depth: false,
		antialias: false,
		premultipliedAlpha: false,
		powerPreference: 'low-power',
	})
	if (!context) return undefined
	host.replaceChildren(canvas)

	const renderer = new Renderer({
		canvas,
		webgl: 1,
		alpha: true,
		depth: false,
		premultipliedAlpha: false,
		powerPreference: 'low-power',
		dpr,
	})
	const gl = renderer.gl
	gl.clearColor(0, 0, 0, 0)

	const current = {deep: [0, 0, 0], primary: [0, 0, 0], secondary: [0, 0, 0], milk: [0, 0, 0]}
	const target = {deep: [0, 0, 0], primary: [0, 0, 0], secondary: [0, 0, 0], milk: [0, 0, 0]}
	let paletteSet = false

	const program = new Program(gl, {
		vertex: VERTEX_SHADER,
		fragment: FRAGMENT_SHADER,
		uniforms: {
			uResolution: {value: [1, 1]},
			uTime: {value: 0},
			uEnergy: {value: 0},
			uPulse: {value: 0},
			uSeed: {value: seed},
			uDeep: {value: current.deep},
			uPrimary: {value: current.primary},
			uSecondary: {value: current.secondary},
			uMilk: {value: current.milk},
		},
		depthTest: false,
		depthWrite: false,
	})
	const mesh = new Mesh(gl, {geometry: new Triangle(gl), program})

	let frameId = 0
	let lost = false
	let disposed = false
	let running = false
	let lastTick = performance.now()
	// The swirl's own clock: advances faster while energised, so typing
	// visibly stirs it without any discontinuity when the energy fades
	let phase = (EPOCH % 100_000) / 1000
	let energy = 0
	let energyTarget = 0
	let pulseLevel = 0

	const blend = (from: number[], to: number[], k: number) => {
		for (let i = 0; i < 3; i++) from[i] += (to[i] - from[i]) * k
	}

	const tick = (now: number) => {
		const dt = Math.min((now - lastTick) / 1000, 0.1)
		lastTick = now
		const rate = energyTarget > energy ? ENERGY_ATTACK : ENERGY_RELEASE
		energy += (energyTarget - energy) * (1 - Math.exp(-rate * dt))
		pulseLevel *= Math.exp(-PULSE_DECAY * dt)
		phase += dt * (1 + energy * 3.5)
		const k = 1 - Math.exp(-PALETTE_BLEND * dt)
		blend(current.deep, target.deep, k)
		blend(current.primary, target.primary, k)
		blend(current.secondary, target.secondary, k)
		blend(current.milk, target.milk, k)
	}

	const draw = () => {
		if (disposed || lost) return
		program.uniforms.uTime.value = phase
		program.uniforms.uEnergy.value = energy
		program.uniforms.uPulse.value = pulseLevel
		renderer.render({scene: mesh})
	}

	const loop = (now: number) => {
		frameId = 0
		if (disposed || lost || !running) return
		tick(now)
		draw()
		frameId = requestAnimationFrame(loop)
	}

	const onLost = (event: Event) => {
		event.preventDefault()
		lost = true
		cancelAnimationFrame(frameId)
		frameId = 0
	}
	canvas.addEventListener('webglcontextlost', onLost)

	const assign = (into: number[], from: Rgb) => {
		into[0] = from[0]
		into[1] = from[1]
		into[2] = from[2]
	}

	return {
		setPalette(palette, instant = !paletteSet) {
			assign(target.deep, palette.deep)
			assign(target.primary, palette.primary)
			assign(target.secondary, palette.secondary)
			assign(target.milk, palette.milk)
			if (instant) {
				assign(current.deep, palette.deep)
				assign(current.primary, palette.primary)
				assign(current.secondary, palette.secondary)
				assign(current.milk, palette.milk)
			}
			paletteSet = true
		},
		setSize(px) {
			renderer.setSize(px, px)
			program.uniforms.uResolution.value = [px * renderer.dpr, px * renderer.dpr]
		},
		setEnergy(next) {
			energyTarget = Math.min(1, Math.max(0, next))
		},
		pulse() {
			pulseLevel = 1
		},
		start() {
			if (running || disposed || lost) return
			running = true
			lastTick = performance.now()
			frameId = requestAnimationFrame(loop)
		},
		stop() {
			running = false
			cancelAnimationFrame(frameId)
			frameId = 0
		},
		frame() {
			const now = performance.now()
			lastTick = now
			// Settle any pending palette blend so a still orb shows its final colours
			const k = 1
			blend(current.deep, target.deep, k)
			blend(current.primary, target.primary, k)
			blend(current.secondary, target.secondary, k)
			blend(current.milk, target.milk, k)
			draw()
		},
		dispose() {
			disposed = true
			running = false
			cancelAnimationFrame(frameId)
			canvas.removeEventListener('webglcontextlost', onLost)
			if (!lost) {
				mesh.geometry.remove()
				program.remove()
				gl.getExtension('WEBGL_lose_context')?.loseContext()
			}
			canvas.remove()
		},
	} satisfies OrbRenderer
}

const VERTEX_SHADER = /* glsl */ `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

// Value-noise fbm on the sphere's surface, drifting and slowly rotating so
// the ribbons of colour cross the face rather than jitter in place. Lit by a
// wide key light up and to the left, with a soft specular bloom, a deeper
// shaded rim and a thin bright glass edge. Film grain keeps the smooth
// gradients from banding on wide-gamut screens.
const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uEnergy;
uniform float uPulse;
uniform float uSeed;
uniform vec3 uDeep;
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec3 uMilk;

varying vec2 vUv;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.55;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p = p * 2.02 + vec3(1.7, 9.2, 4.1);
    a *= 0.42;
  }
  return v;
}

float grain(vec2 p, float t) {
  return fract(sin(dot(p + t, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  // ~1.5px of anti-aliasing at the rim, in clip units
  float aa = 3.0 / uResolution.x;
  float R = 0.96;
  float edge = 1.0 - smoothstep(R - aa, R + aa, r);
  if (edge <= 0.001) discard;

  float rn = min(r / R, 1.0);
  float z = sqrt(1.0 - rn * rn);
  vec3 n = normalize(vec3(p / R, z));

  float t = uTime;
  // Turn the noise domain, not the sphere: the lighting stays put while the
  // colour underneath keeps rolling past
  float a = t * 0.1 + uSeed;
  vec3 nr = vec3(n.x * cos(a) - n.z * sin(a), n.y, n.x * sin(a) + n.z * cos(a));
  vec3 q = nr * 1.05 + vec3(uSeed * 3.1, 0.0, 0.0);
  float f1 = fbm(q + vec3(0.0, t * 0.08, t * 0.05));
  float f2 = fbm(q * 1.55 + vec3(t * 0.06, 0.0, -t * 0.07) + 7.3);
  float band = 0.5 + 0.5 * sin(nr.x * 2.2 + nr.y * 1.6 + f1 * 4.2 + t * 0.28);

  // A thin ribbon of light threading through the swirl
  float ribbon = sin(nr.y * 3.4 - nr.x * 1.2 + f1 * 6.5 - t * 0.22);
  float streak = smoothstep(0.82, 0.98, ribbon);

  vec3 col = mix(uPrimary, uSecondary, smoothstep(0.05, 0.95, band));
  col = mix(col, uMilk, smoothstep(0.3, 0.95, f2) * 0.72);
  col = mix(col, uMilk, streak * 0.35);
  col = mix(col, uDeep, smoothstep(0.5, 1.0, f1) * (1.0 - z) * 0.4);
  col *= 1.0 + uEnergy * 0.16;

  vec3 L = normalize(vec3(-0.5, 0.66, 0.56));
  float diff = dot(n, L) * 0.5 + 0.5;
  col *= 0.74 + 0.36 * diff;
  col *= 0.92 + 0.08 * n.y;
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float nh = max(dot(n, H), 0.0);
  float bloom = pow(nh, 5.0);
  float hot = pow(nh, 40.0);
  col += uMilk * bloom * (0.5 + uEnergy * 0.3) + vec3(1.0) * hot * 0.22;

  float rim = pow(1.0 - z, 3.0);
  col = mix(col, uDeep * 0.9, rim * 0.5);
  col += uMilk * pow(1.0 - z, 10.0) * 0.35;

  col += uMilk * uPulse * 0.38;
  col += (grain(gl_FragCoord.xy, floor(t * 14.0)) - 0.5) * 0.05;

  gl_FragColor = vec4(col, edge);
}
`
