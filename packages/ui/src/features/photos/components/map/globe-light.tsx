import type {Map as MapLibreMap} from 'maplibre-gl'
import {useEffect, useRef, useState} from 'react'

import type {OfflineMapData} from '@/features/photos/components/map/atlas'
import {mapCamera, viewSize} from '@/features/photos/components/map/globe'
import {EARTH_ZOOM, MAP_ZOOM} from '@/features/photos/components/map/map-style'
import {direction, sunOverhead} from '@/features/photos/components/map/sun'

// The light on the globe, and the weather: the Earth as it is at this moment
// from where the map looks at it. The sun is where it really is, so the side
// it is day on is lit and the other is in the dark, with dusk between them;
// clouds lie over it, in the bands the real ones keep to, lit from the same
// sun and laying their shadows; the air glows round its edge; and in the
// dark are the lights of its cities, and round the poles the aurora. Past
// the edge on the night side, the sun itself comes into sight.
//
// It is one pass over the map, drawn above it with the same camera (see
// globe.ts): what it adds is light, what it takes away is shade. It dims out
// as the globe is come in to — close to, the map is evenly lit. Nothing in it
// moves by itself, so it is only drawn when the map is.

// Clouds are made once, as a map of the whole sky: three scales of noise,
// stirred into each other the way weather is, and thinned or thickened by
// latitude — the rains along the equator and the storm tracks of the
// fifties, the clear skies of the deserts between
const WEATHER = /* glsl */ `
precision highp float;
uniform vec2 u_extent;
uniform float u_day;

float hash(vec3 at) {
	at = fract(at * 0.3183099 + 0.1) * 17.0;
	return fract(at.x * at.y * at.z * (at.x + at.y + at.z));
}
float noise(vec3 at) {
	vec3 cell = floor(at);
	vec3 within = fract(at);
	within = within * within * (3.0 - 2.0 * within);
	return mix(
		mix(mix(hash(cell), hash(cell + vec3(1, 0, 0)), within.x), mix(hash(cell + vec3(0, 1, 0)), hash(cell + vec3(1, 1, 0)), within.x), within.y),
		mix(mix(hash(cell + vec3(0, 0, 1)), hash(cell + vec3(1, 0, 1)), within.x), mix(hash(cell + vec3(0, 1, 1)), hash(cell + vec3(1, 1, 1)), within.x), within.y),
		within.z);
}
float billows(vec3 at) {
	float sum = 0.0;
	float weight = 0.5;
	for (int octave = 0; octave < 6; octave++) {
		sum += weight * noise(at);
		at = at * 2.03 + 11.3;
		weight *= 0.5;
	}
	return sum;
}

void main() {
	vec2 at = gl_FragCoord.xy / u_extent;
	float longitude = (at.x - 0.5) * 6.2831853;
	float latitude = (at.y - 0.5) * 3.1415927;
	vec3 place = vec3(cos(latitude) * cos(longitude), cos(latitude) * sin(longitude), sin(latitude));
	// Drawn out along the parallels, as weather is by the Earth's turning
	vec3 from = vec3(place.xy, place.z * 1.55) * 2.1 + u_day;
	vec3 stirred = vec3(billows(from * 1.3 + 3.1), billows(from * 1.3 + 17.7), billows(from * 1.3 + 41.3)) - 0.5;
	// The big weather, what it is made of, and its ragged edges
	float systems = billows(from + stirred * 2.8);
	float wisps = billows(from * 3.6 + stirred * 5.0 + 7.0);
	float fine = billows(from * 11.0 + stirred * 7.0 + 23.0);
	float climate = 0.5 + 0.5 * cos(latitude * 6.8);
	float cover = systems * 0.5 + wisps * 0.34 + fine * 0.16 + (climate - 0.5) * 0.2;
	// Thin at its edges, thick in the middle of a system
	float cloud = smoothstep(0.455, 0.66, cover) * (0.5 + 0.5 * smoothstep(0.48, 0.7, systems * 0.6 + wisps * 0.4));
	gl_FragColor = vec4(cloud, wisps, systems, 1.0);
}
`

const CAMERA = /* glsl */ `
precision highp float;
uniform vec2 u_size;
uniform float u_ratio;
uniform vec2 u_origin;
uniform float u_focal;
uniform float u_radius;
uniform vec3 u_east;
uniform vec3 u_north;
uniform vec3 u_out;
uniform vec3 u_sun;
uniform float u_strength;
uniform float u_drift;
uniform sampler2D u_weather;

// Where in the map of the sky the weather over a place is
vec2 skyOver(vec3 place) {
	return vec2(atan(place.y, place.x) / 6.2831853 + 0.5 + u_drift, asin(clamp(place.z, -1.0, 1.0)) / 3.1415927 + 0.5);
}
`

const SHADE = /* glsl */ `
${CAMERA}
const vec3 NIGHT = vec3(0.010, 0.024, 0.070);
const vec3 AIR = vec3(0.36, 0.62, 1.0);
const vec3 AIR_AT_NIGHT = vec3(0.05, 0.10, 0.26);
const vec3 DUSK = vec3(1.0, 0.46, 0.18);
const vec3 SUNLIGHT = vec3(1.0, 0.95, 0.86);
// Where the Earth's magnet points: the aurora rings it, north and south
const vec3 MAGNETIC_POLE = vec3(0.0481, -0.1543, 0.9868);

// A direction in the camera's frame — right, up, away — as one out of the Earth
vec3 onEarth(vec3 seen) {
	return seen.x * u_east + seen.y * u_north - seen.z * u_out;
}
// A bell of this width about nought
float bell(float from, float width) {
	return exp(-(from / width) * (from / width));
}
// One thing laid over another, both with their colour already scaled by how solid they are
vec4 over(vec4 under, vec4 top) {
	return vec4(top.rgb + under.rgb * (1.0 - top.a), top.a + under.a * (1.0 - top.a));
}

void main() {
	vec2 at = gl_FragCoord.xy / u_ratio;
	vec3 ray = normalize(vec3(at.x - u_origin.x, at.y - (u_size.y - u_origin.y), u_focal));
	vec3 centre = vec3(0.0, 0.0, u_focal + u_radius);
	float along = dot(ray, centre);
	float miss = sqrt(max(0.0, dot(centre, centre) - along * along));
	vec3 sunSeen = vec3(dot(u_sun, u_east), dot(u_sun, u_north), -dot(u_sun, u_out));
	vec4 laid = vec4(0.0);
	vec3 light = vec3(0.0);

	if (miss < u_radius) {
		// On the globe: where, how the sun stands there, and how squarely it is seen
		vec3 normal = (ray * (along - sqrt(u_radius * u_radius - miss * miss)) - centre) / u_radius;
		vec3 place = onEarth(normal);
		float sun = dot(place, u_sun);
		float day = smoothstep(-0.16, 0.14, sun);
		float dusk = bell(sun, 0.085);
		float edge = 1.0 - max(0.0, -dot(normal, ray));

		// Night falls: the dark side goes deep blue, not black, so it can still be read
		laid = vec4(NIGHT, 1.0) * ((1.0 - day) * 0.53);

		// The weather. A cloud's shadow falls on the ground away from the sun,
		// longer the lower the sun is; the cloud itself is white by day, takes
		// the colour of the sunset where it is one, and is a dim grey at night
		vec2 sky = skyOver(place);
		vec3 weather = texture2D(u_weather, sky).rgb;
		vec3 sunward = normalize(u_sun - place * sun + place * 0.0001);
		float shadow = texture2D(u_weather, skyOver(normalize(place + sunward * (0.006 + 0.014 * (1.0 - max(0.0, sun)))))).r;
		laid = over(laid, vec4(0.0, 0.0, 0.0, shadow * 0.26 * day));
		vec3 cloudLit = mix(vec3(0.085, 0.105, 0.17), vec3(0.97, 0.98, 1.0) * (0.8 + 0.2 * max(0.0, sun)), day);
		cloudLit = mix(cloudLit, vec3(1.0, 0.66, 0.46), dusk * 0.6);
		float veil = weather.r * 0.6 * (1.0 - 0.35 * pow(edge, 2.0));
		laid = over(laid, vec4(cloudLit * veil, veil));

		// The globe is round: it darkens towards its edge …
		laid = over(laid, vec4(0.0, 0.0, 0.0, pow(edge, 3.0) * 0.34));
		// … where the air catches the light, a thin bright line on the day side
		light += mix(AIR_AT_NIGHT, AIR, day) * (pow(edge, 5.0) * 0.55 + pow(edge, 14.0) * 0.5);
		// Dusk and dawn: a warm band along the line between day and night
		light += DUSK * dusk * 0.12 * (1.0 - 0.6 * edge);
		// The sun itself: a soft brightening where it is high, and the sheen of
		// it off the globe where it glances towards the eye
		light += SUNLIGHT * pow(max(0.0, sun), 2.5) * 0.085;
		light += SUNLIGHT * pow(max(0.0, dot(normal, normalize(sunSeen - ray))), 48.0) * 0.16 * day * (1.0 - veil);

		// The aurora: a ring of green round each magnetic pole, brightest
		// towards midnight, uneven the way its curtains are, red at its rim
		float fromPole = acos(clamp(abs(dot(place, MAGNETIC_POLE)), 0.0, 1.0));
		float ring = (fromPole - 0.4) / 0.036;
		float curtains = texture2D(u_weather, vec2(sky.x * 7.0, 0.43)).g * texture2D(u_weather, vec2(sky.x * 2.0 + 0.3, 0.61)).b;
		float aurora = bell(ring, 1.0) * (1.0 - smoothstep(-0.3, 0.02, sun)) * (0.25 + 4.2 * curtains * curtains);
		light += (vec3(0.14, 1.0, 0.5) + vec3(0.75, 0.1, 0.55) * smoothstep(0.3, 1.5, ring)) * aurora * 0.28 * (1.0 - 0.7 * veil);
	} else {
		// Off the globe: the air above its edge, glowing where the sun reaches it
		float height = (miss - u_radius) / u_radius;
		float sun = dot(onEarth(normalize(ray * along - centre)), u_sun);
		// By day it is blue, a thin bright line and a wide faint one. Behind the
		// Earth it is every sunset there is at once: a ring of ember round the dark
		float lit = smoothstep(-0.22, 0.25, sun);
		float thin = exp(-height / 0.02);
		light = AIR * lit * (thin * 0.9 + exp(-height / 0.085) * 0.34 + exp(-height / 0.3) * 0.07);
		light += AIR_AT_NIGHT * (1.0 - lit) * (thin * 0.5 + exp(-height / 0.07) * 0.14);
		light += DUSK * bell(sun + 0.1, 0.17) * (thin * 0.85 + exp(-height / 0.06) * 0.22);
		// And the sun, where it clears the globe: its disc, the glare round
		// it, and the haze of that across the sky
		float toSun = max(0.0, dot(ray, sunSeen));
		light += SUNLIGHT * (pow(toSun, 20000.0) * 3.0 + pow(toSun, 2500.0) * 0.8);
		light += vec3(1.0, 0.86, 0.66) * (pow(toSun, 250.0) * 0.26 + pow(toSun, 25.0) * 0.07 + pow(toSun, 5.0) * 0.02);
	}
	gl_FragColor = vec4(laid.rgb + light, laid.a) * u_strength;
}
`

const LIGHTS_AT = /* glsl */ `
${CAMERA}
attribute vec3 a_place;
attribute float a_size;
varying float v_light;
varying vec2 v_sky;

void main() {
	float facing = dot(a_place, u_out);
	float horizon = u_radius / (u_radius + u_focal);
	float depth = u_focal + u_radius * (1.0 - facing);
	vec2 seen = u_origin + vec2(dot(a_place, u_east), -dot(a_place, u_north)) * u_radius * u_focal / depth;
	// Lit once the sun is down, and dimmer towards the globe's edge
	float night = 1.0 - smoothstep(-0.12, 0.05, dot(a_place, u_sun));
	float round = smoothstep(horizon, horizon + 0.2, facing);
	v_light = night * round * u_strength * (0.4 + 0.6 * a_size);
	v_sky = skyOver(a_place);
	gl_Position = v_light > 0.004 ? vec4(seen.x / u_size.x * 2.0 - 1.0, 1.0 - seen.y / u_size.y * 2.0, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
	// Bigger the bigger the city, and with the globe
	gl_PointSize = (2.2 + 5.5 * a_size) * u_ratio * clamp(u_radius / 330.0, 0.75, 2.2);
}
`

const LIGHTS = /* glsl */ `
precision highp float;
uniform sampler2D u_weather;
varying float v_light;
varying vec2 v_sky;

void main() {
	float from = length(gl_PointCoord - 0.5) * 2.0;
	// A bright middle in a soft warm glow, dimmed under cloud
	float glow = exp(-from * from * 5.0) * 0.75 + exp(-from * from * 40.0) * 0.6;
	float clear = 1.0 - 0.75 * texture2D(u_weather, v_sky).r;
	gl_FragColor = vec4(vec3(1.0, 0.79, 0.47) * glow * v_light * clear, 0.0);
}
`

const CORNERS = 'attribute vec2 a_corner; void main() { gl_Position = vec4(a_corner, 0.0, 1.0); }'
const UNIFORMS = [
	'size',
	'ratio',
	'origin',
	'focal',
	'radius',
	'east',
	'north',
	'out',
	'sun',
	'strength',
	'drift',
	'weather',
	'extent',
	'day',
] as const
const WEATHER_EXTENT = [1024, 512] as const
const DAY_MS = 86_400_000

function program(gl: WebGLRenderingContext, vertex: string, fragment: string) {
	const made = gl.createProgram()!
	for (const [type, source] of [
		[gl.VERTEX_SHADER, vertex],
		[gl.FRAGMENT_SHADER, fragment],
	] as const) {
		const shader = gl.createShader(type)!
		gl.shaderSource(shader, source)
		gl.compileShader(shader)
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader')
		gl.attachShader(made, shader)
	}
	gl.linkProgram(made)
	if (!gl.getProgramParameter(made, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(made) ?? 'program')
	return {
		program: made,
		uniforms: Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(made, `u_${name}`)])) as Record<
			(typeof UNIFORMS)[number],
			WebGLUniformLocation | null
		>,
	}
}

// How much of the light there is at a zoom: all of it on the Earth from
// afar, and none once it is the map (see the style's EARTH)
function strengthAt(zoom: number) {
	const along = Math.min(1, Math.max(0, (zoom - EARTH_ZOOM) / (MAP_ZOOM - EARTH_ZOOM)))
	return 1 - along * along * (3 - 2 * along)
}

// The sun moves a quarter of a degree a minute
const KEEP_UP_MS = 60_000

export function GlobeLight({map, atlas}: {map: MapLibreMap | undefined; atlas: OfflineMapData | undefined}) {
	const places = useRef<{buffer: WebGLBuffer; count: number}>(undefined)
	const state = useRef<{gl: WebGLRenderingContext; draw: () => void}>(undefined)
	// The GPU can take the light's context away — a phone does, for a page in
	// the background — and everything made in it goes with it. Given back, it
	// is all made again, on a canvas of its own
	const [restored, setRestored] = useState(0)

	useEffect(() => {
		if (!map) return
		const canvas = document.createElement('canvas')
		canvas.className = 'pointer-events-none absolute inset-0 size-full'
		canvas.setAttribute('aria-hidden', 'true')
		// (A context is only given back if its loss is prevented)
		const listening = new AbortController()
		canvas.addEventListener('webglcontextlost', (event) => event.preventDefault(), {signal: listening.signal})
		canvas.addEventListener('webglcontextrestored', () => setRestored((count) => count + 1), {signal: listening.signal})
		const gl = canvas.getContext('webgl', {antialias: false, depth: false, stencil: false})
		if (!gl) return
		let shade: ReturnType<typeof program>
		let lights: ReturnType<typeof program>
		let weather: ReturnType<typeof program>
		try {
			shade = program(gl, CORNERS, SHADE)
			lights = program(gl, LIGHTS_AT, LIGHTS)
			weather = program(gl, CORNERS, WEATHER)
		} catch {
			// No light is no loss of anything else: the map is whole without it
			return
		}
		const corners = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, corners)
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
		const fill = (using: ReturnType<typeof program>) => {
			gl.bindBuffer(gl.ARRAY_BUFFER, corners)
			const corner = gl.getAttribLocation(using.program, 'a_corner')
			gl.enableVertexAttribArray(corner)
			gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0)
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
			gl.disableVertexAttribArray(corner)
		}

		// Today's weather: a sky of it, made once. It is a different one each day.
		const sky = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_2D, sky)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ...WEATHER_EXTENT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		const drawing = gl.createFramebuffer()
		gl.bindFramebuffer(gl.FRAMEBUFFER, drawing)
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sky, 0)
		gl.viewport(0, 0, ...WEATHER_EXTENT)
		gl.useProgram(weather.program)
		gl.uniform2f(weather.uniforms.extent, ...WEATHER_EXTENT)
		gl.uniform1f(weather.uniforms.day, (Math.floor(Date.now() / DAY_MS) % 997) * 1.37)
		fill(weather)
		gl.bindFramebuffer(gl.FRAMEBUFFER, null)
		gl.deleteFramebuffer(drawing)

		// Over the map, and under the markers that are laid over it
		map.getCanvas().after(canvas)

		const draw = () => {
			const camera = mapCamera(map)
			const strength = strengthAt(camera.zoom)
			// With no light to add it is taken out of the page: left in, even a
			// clear sheet is laid over the map every frame
			canvas.style.visibility = strength === 0 ? 'hidden' : ''
			if (strength === 0) return
			const ratio = Math.min(2, window.devicePixelRatio || 1)
			const {width, height} = viewSize(map)
			if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
				canvas.width = Math.round(width * ratio)
				canvas.height = Math.round(height * ratio)
			}
			gl.viewport(0, 0, canvas.width, canvas.height)
			const now = Date.now()
			const sun = sunOverhead(now)
			const set = ({uniforms}: ReturnType<typeof program>) => {
				gl.uniform2f(uniforms.size, width, height)
				gl.uniform1f(uniforms.ratio, canvas.width / width)
				gl.uniform2f(uniforms.origin, camera.origin.x, camera.origin.y)
				gl.uniform1f(uniforms.focal, camera.focal)
				gl.uniform1f(uniforms.radius, camera.radius)
				gl.uniform3fv(uniforms.east, camera.east)
				gl.uniform3fv(uniforms.north, camera.north)
				gl.uniform3fv(uniforms.out, camera.out)
				gl.uniform3fv(uniforms.sun, direction(sun.lng, sun.lat))
				gl.uniform1f(uniforms.strength, strength)
				// The weather goes east, a few degrees of longitude a day
				gl.uniform1f(uniforms.drift, -((now % DAY_MS) / DAY_MS) * (6 / 360))
				gl.uniform1i(uniforms.weather, 0)
			}
			gl.activeTexture(gl.TEXTURE0)
			gl.bindTexture(gl.TEXTURE_2D, sky)

			gl.useProgram(shade.program)
			set(shade)
			gl.disable(gl.BLEND)
			fill(shade)

			if (!places.current) return
			gl.useProgram(lights.program)
			set(lights)
			// Lights are added to what is there, and shade none of it
			gl.enable(gl.BLEND)
			gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE)
			gl.bindBuffer(gl.ARRAY_BUFFER, places.current.buffer)
			const [place, size] = [
				gl.getAttribLocation(lights.program, 'a_place'),
				gl.getAttribLocation(lights.program, 'a_size'),
			]
			gl.enableVertexAttribArray(place)
			gl.enableVertexAttribArray(size)
			gl.vertexAttribPointer(place, 3, gl.FLOAT, false, 16, 0)
			gl.vertexAttribPointer(size, 1, gl.FLOAT, false, 16, 12)
			gl.drawArrays(gl.POINTS, 0, places.current.count)
			gl.disableVertexAttribArray(place)
			gl.disableVertexAttribArray(size)
		}
		state.current = {gl, draw}
		// With the map, in the frame it draws: the light never trails the globe
		map.on('move', draw)
		map.on('resize', draw)
		const keepingUp = setInterval(draw, KEEP_UP_MS)
		draw()
		return () => {
			clearInterval(keepingUp)
			map.off('move', draw)
			map.off('resize', draw)
			state.current = undefined
			places.current = undefined
			listening.abort()
			canvas.remove()
			gl.getExtension('WEBGL_lose_context')?.loseContext()
		}
	}, [map, restored])

	// The cities, once the atlas that knows them is here: where each is, and
	// how big, from a town of twenty thousand to a city of twenty million
	useEffect(() => {
		const current = state.current
		if (!current || !atlas) return
		const {gl, draw} = current
		const packed = new Float32Array(atlas.p.length * 4)
		atlas.p.forEach(([lng, lat, , , , population], index) => {
			packed.set(direction(lng, lat), index * 4)
			packed[index * 4 + 3] = Math.min(1, Math.max(0, (Math.log10(Math.max(1, population)) - 4.3) / 3))
		})
		const buffer = gl.createBuffer()!
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
		gl.bufferData(gl.ARRAY_BUFFER, packed, gl.STATIC_DRAW)
		places.current = {buffer, count: atlas.p.length}
		draw()
	}, [map, atlas, restored])

	return null
}
