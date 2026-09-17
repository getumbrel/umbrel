import {Mesh, Program, Renderer, Triangle} from 'ogl'

const TRAIL_LENGTH = 37
const TRAIL_WIDTH = 4
const TRAIL_TAPER = 0.9
const FOLLOW_SPEED = 0.42
const HOTSPOT = 0.39
const BRIGHTNESS = 1.9
const OPACITY = 0.77
const PULSE_SPEED = 1.1
const NOISE_STRENGTH = 0.035
const IDLE_TIMEOUT_MS = 2_000
const FADE_DURATION_MS = 1_000

export type AgentGlowTrail = {
	move: (x: number, y: number, width: number, height: number, moving: boolean) => void
	clear: () => void
	dispose: () => void
}

export function createAgentGlowTrail(canvas: HTMLCanvasElement, color: string): AgentGlowTrail | undefined {
	// The solid SVG pointer still works when WebGL is unavailable.
	if (
		!canvas.getContext('webgl', {
			alpha: true,
			depth: false,
			antialias: false,
			premultipliedAlpha: false,
			powerPreference: 'low-power',
		})
	)
		return
	const renderer = new Renderer({
		canvas,
		webgl: 1,
		alpha: true,
		depth: false,
		powerPreference: 'low-power',
		dpr: Math.min(devicePixelRatio || 1, 1.5),
	})
	const gl = renderer.gl
	gl.clearColor(0, 0, 0, 0)
	const rgb = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
	// OGL resolves GLSL array uniforms through plain arrays.
	const points = Array<number>(TRAIL_LENGTH * 2).fill(0)
	const program = new Program(gl, {
		vertex: VERTEX_SHADER,
		fragment: FRAGMENT_SHADER,
		uniforms: {
			uResolution: {value: [1, 1]},
			uPoints: {value: points},
			uColor: {value: rgb.map((channel) => channel + (1 - channel) * 0.65)},
			uSecondaryColor: {value: rgb.map((channel) => channel * 0.65)},
			uTrailWidth: {value: TRAIL_WIDTH},
			uTaper: {value: TRAIL_TAPER},
			uHotspot: {value: HOTSPOT},
			uBrightness: {value: BRIGHTNESS},
			uOpacity: {value: OPACITY},
			uPulseSpeed: {value: PULSE_SPEED},
			uNoiseStrength: {value: NOISE_STRENGTH},
			uTime: {value: 0},
			uFade: {value: 0},
		},
		// One full-screen triangle writes straight RGBA into a transparent
		// canvas. Browser compositing applies alpha exactly once.
		depthTest: false,
		depthWrite: false,
	})
	const mesh = new Mesh(gl, {geometry: new Triangle(gl), program})
	let width = 0
	let height = 0
	let initialized = false
	let lastInput = 0
	let lastFrame = 0
	let frame = 0
	let lost = false
	let disposed = false
	const target = {x: 0, y: 0}

	// A blended, console-sized layer costs the compositor a pass over every
	// guest frame even when fully transparent, so it only exists while drawn
	canvas.style.visibility = 'hidden'
	const clear = () => {
		cancelAnimationFrame(frame)
		frame = 0
		initialized = false
		canvas.style.visibility = 'hidden'
		if (!lost) {
			gl.disable(gl.SCISSOR_TEST)
			gl.clear(gl.COLOR_BUFFER_BIT)
		}
	}
	const render = (now: number) => {
		frame = 0
		if (disposed || lost) return
		const fade = 1 - Math.max(0, Math.min(1, (now - lastInput - IDLE_TIMEOUT_MS) / FADE_DURATION_MS))
		if (!fade) return clear()
		const delta = Math.min((now - lastFrame) / (1_000 / 60), 3)
		lastFrame = now
		const ease = 1 - (1 - (0.28 + FOLLOW_SPEED * 0.35)) ** delta
		// The trail can flow behind; its head and the arrow stay exactly on
		// the input coordinate, without adding another cursor-follow delay.
		points[0] = target.x
		points[1] = target.y
		for (let i = 2; i < points.length; i++) points[i] += (points[i - 2] - points[i]) * ease
		program.uniforms.uTime.value = now / 1_000
		program.uniforms.uFade.value = fade
		gl.disable(gl.SCISSOR_TEST)
		gl.clear(gl.COLOR_BUFFER_BIT)
		// Shade just the trail's neighborhood, rather than every pixel of a
		// large desktop. The shader fades to zero before this boundary.
		let minX = target.x,
			maxX = target.x,
			minY = target.y,
			maxY = target.y
		for (let i = 0; i < points.length; i += 2) {
			minX = Math.min(minX, points[i])
			maxX = Math.max(maxX, points[i])
			minY = Math.min(minY, points[i + 1])
			maxY = Math.max(maxY, points[i + 1])
		}
		const left = Math.max(0, minX - 100),
			bottom = Math.max(0, minY - 100)
		gl.enable(gl.SCISSOR_TEST)
		gl.scissor(
			Math.floor(left * renderer.dpr),
			Math.floor(bottom * renderer.dpr),
			Math.ceil((Math.min(width, maxX + 100) - left) * renderer.dpr),
			Math.ceil((Math.min(height, maxY + 100) - bottom) * renderer.dpr),
		)
		renderer.render({scene: mesh, clear: false})
		frame = requestAnimationFrame(render)
	}
	const onHidden = () => {
		if (document.hidden) clear()
	}
	const onLost = (event: Event) => {
		event.preventDefault()
		lost = true
		clear()
	}
	canvas.addEventListener('webglcontextlost', onLost)
	document.addEventListener('visibilitychange', onHidden)

	return {
		move(x, y, nextWidth, nextHeight, moving) {
			if (disposed || lost || document.hidden) return
			if (width !== nextWidth || height !== nextHeight) {
				clear()
				width = nextWidth
				height = nextHeight
				renderer.setSize(width, height)
				program.uniforms.uResolution.value = [width, height]
			}
			const nextY = height - y
			const changed = Math.hypot(x - target.x, nextY - target.y) > 0.1
			target.x = x
			target.y = nextY
			if (!initialized) {
				if (!moving) return
				for (let i = 0; i < points.length; i += 2) {
					points[i] = x
					points[i + 1] = nextY
				}
				initialized = true
			}
			if (moving || changed) lastInput = performance.now()
			if (!frame) {
				canvas.style.visibility = ''
				lastFrame = performance.now()
				frame = requestAnimationFrame(render)
			}
		},
		clear,
		dispose() {
			disposed = true
			clear()
			canvas.removeEventListener('webglcontextlost', onLost)
			document.removeEventListener('visibilitychange', onHidden)
			// A lost context has already invalidated these GPU resources.
			if (!lost) {
				mesh.geometry.remove()
				program.remove()
			}
		},
	}
}

// Adapted from the supplied GlowCursor shader. Only the agent's input stream
// drives this surface; it never listens to the viewer's mouse.
const VERTEX_SHADER = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`
const FRAGMENT_SHADER = `
precision highp float;

#define MAX_POINTS ${TRAIL_LENGTH}

uniform vec2 uResolution;
uniform vec2 uPoints[MAX_POINTS];
uniform vec3 uColor;
uniform vec3 uSecondaryColor;
uniform float uTrailWidth;
uniform float uTaper;
uniform float uHotspot;
uniform float uBrightness;
uniform float uOpacity;
uniform float uPulseSpeed;
uniform float uNoiseStrength;
uniform float uTime;
uniform float uFade;

varying vec2 vUv;

float sRGB(float x) {
  if (x <= 0.00031308) return 12.92 * x;
  return 1.055 * pow(x, 1.0 / 2.4) - 0.055;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float filmGrain(vec2 p, float time) {
  float frame = time * 18.0;
  float frameIndex = mod(floor(frame), 256.0);
  float nextFrameIndex = mod(frameIndex + 1.0, 256.0);
  float blend = fract(frame);
  blend = blend * blend * (3.0 - 2.0 * blend);
  vec2 pixel = floor(p);
  float current = hash(pixel + vec2(frameIndex * 17.0, frameIndex * 31.0));
  float next = hash(pixel + vec2(nextFrameIndex * 17.0, nextFrameIndex * 31.0));
  return mix(current, next, blend) * 2.0 - 1.0;
}

void main() {
  vec2 pixel = vUv * uResolution;
  float denominator = float(MAX_POINTS - 1);
  float strongest = 0.0;
  float strongestCore = 0.0;
  float colorWeight = 0.0;
  vec3 colorSum = vec3(0.0);

  for (int i = 0; i < MAX_POINTS - 1; i++) {
    float index = float(i);
    vec2 start = uPoints[i];
    vec2 end = uPoints[i + 1];
    vec2 toPixel = pixel - start;
    vec2 segment = end - start;
    float along = clamp(dot(toPixel, segment) / max(dot(segment, segment), 0.0001), 0.0, 1.0);
    float progress = clamp((index + along) / denominator, 0.0, 1.0);
    float life = pow(max(1.0 - progress, 0.0), mix(0.55, 1.25, uTaper));
    float width = uTrailWidth * mix(1.0, 0.25, pow(progress, mix(0.55, 1.6, uTaper)));
    float distanceToTrail = length(toPixel - segment * along);
    float core = exp(-pow(distanceToTrail / max(width, 0.5), 2.0) * 2.5);
    float pulseAmount = min(abs(uPulseSpeed), 1.0);
    float pulse = 1.0 + sin(uTime * uPulseSpeed * 3.0 - progress * 11.0) * 0.16 * pulseAmount;
    float intensity = core * life * pulse;
    vec3 segmentColor = mix(uColor, uSecondaryColor, progress);

    strongest = max(strongest, intensity);
    strongestCore = max(strongestCore, core * life);
    colorSum += segmentColor * intensity;
    colorWeight += intensity;
  }

  float grain = filmGrain(pixel, uTime);
  float noiseAmount = (1.0 - exp(-uNoiseStrength * 2.2)) * 0.4;
  float alpha = clamp(strongest * uOpacity * uFade, 0.0, 1.0);
  if (alpha < 0.0005) discard;

  vec3 color = colorSum / max(colorWeight, 0.0001);
  color = mix(color, vec3(1.0), smoothstep(0.25, 0.95, strongestCore) * uHotspot);
  float luminance = sRGB(clamp(strongest * uBrightness, 0.0, 1.0));
  luminance *= 1.0 + grain * noiseAmount;
  gl_FragColor = vec4(color * luminance, alpha);
}
`
