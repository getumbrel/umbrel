import type {Map as MapLibreMap} from 'maplibre-gl'
import {useEffect, useRef} from 'react'

import {mapCamera, viewSize} from '@/features/photos/components/map/globe'
import {direction, moonOverhead, skyTurn, sunOverhead} from '@/features/photos/components/map/sun'

// The night sky the globe hangs in: every star the eye can see, where it is
// from above the place the map is centred on, at this moment. The camera
// that draws the globe draws them, so turning the globe is going round the
// Earth, and the sky goes by as it would. They are drawn beneath the map,
// which is clear wherever the globe isn't.
// (scripts/build-photos-stars.mjs packs the catalogue, and says what is in it.)
type Stars = {
	count: number
	// Unit vectors on the sky, x towards the vernal equinox, z towards the north pole
	place: Float32Array
	radius: Float32Array
	alpha: Float32Array
	colour: string[]
}

let catalogue: Promise<Stars> | undefined
const loadStars = () =>
	(catalogue ??= fetch('/assets/photos/stars-v1.bin')
		.then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error('No stars'))))
		.then(unpack)
		.catch((error) => {
			catalogue = undefined
			throw error
		}))

function unpack(buffer: ArrayBuffer): Stars {
	const view = new DataView(buffer)
	const count = Math.floor(buffer.byteLength / 6)
	const stars: Stars = {
		count,
		place: new Float32Array(count * 3),
		radius: new Float32Array(count),
		alpha: new Float32Array(count),
		colour: new Array(count),
	}
	for (let index = 0; index < count; index++) {
		const ascension = (view.getUint16(index * 6, true) / 65535) * 2 * Math.PI
		const declination = ((view.getInt16(index * 6 + 2, true) / 32767) * Math.PI) / 2
		stars.place[index * 3] = Math.cos(declination) * Math.cos(ascension)
		stars.place[index * 3 + 1] = Math.cos(declination) * Math.sin(ascension)
		stars.place[index * 3 + 2] = Math.sin(declination)
		// How much brighter than the faintest the eye makes out, in magnitudes:
		// most are a faint dusting, and a few dozen stand out
		const brightness = Math.max(0, 6.5 - (view.getUint8(index * 6 + 4) / 30 - 2))
		stars.radius[index] = 0.5 + 0.085 * brightness ** 1.75
		stars.alpha[index] = Math.min(1, 0.2 + 0.085 * brightness ** 1.3)
		stars.colour[index] = colourOf(view.getUint8(index * 6 + 5) / 100 - 0.5)
	}
	return stars
}

// A star's colour from its B−V index: blue-white for the hot ones, through
// white and the Sun's cream, to the orange of the cool giants
const COLOURS: Array<[index: number, red: number, green: number, blue: number]> = [
	[-0.4, 170, 191, 255],
	[0, 214, 224, 255],
	[0.3, 248, 247, 255],
	[0.65, 255, 244, 232],
	[1.1, 255, 214, 170],
	[1.6, 255, 190, 127],
	[2.1, 255, 170, 100],
]
function colourOf(index: number) {
	const next = COLOURS.findIndex(([at]) => at >= index)
	const upper = next === -1 ? COLOURS.length - 1 : Math.max(1, next)
	const [from, to] = [COLOURS[upper - 1]!, COLOURS[upper]!]
	const along = Math.min(1, Math.max(0, (index - from[0]) / (to[0] - from[0])))
	const mix = (channel: 1 | 2 | 3) => Math.round(from[channel] + (to[channel] - from[channel]) * along)
	return `rgb(${mix(1)} ${mix(2)} ${mix(3)})`
}

// The Milky Way: the plane of the galaxy round the sky, as a run of soft
// lights along it — broad and bright towards the galaxy's middle, in
// Sagittarius, thin and faint away from it — each a little off the line, the
// way its clouds are. Where it is in the sky is right; what it looks like is
// an impression.
const GALAXY = (() => {
	const radians = Math.PI / 180
	const towards = (ascension: number, declination: number) => [
		Math.cos(declination * radians) * Math.cos(ascension * radians),
		Math.cos(declination * radians) * Math.sin(ascension * radians),
		Math.sin(declination * radians),
	]
	const middle = towards(266.405, -28.936)
	const pole = towards(192.859, 27.128)
	const across = [
		pole[1]! * middle[2]! - pole[2]! * middle[1]!,
		pole[2]! * middle[0]! - pole[0]! * middle[2]!,
		pole[0]! * middle[1]! - pole[1]! * middle[0]!,
	]
	const clouds: Array<{place: number[]; reach: number; light: number; warmth: number}> = []
	for (let longitude = 0; longitude < 360; longitude += 2.5) {
		// A fixed scatter, the same every time: sines of unrelated lengths
		const scatter = Math.sin(longitude * 12.9898) * 0.5 + Math.sin(longitude * 4.1414 + 1.7) * 0.5
		const nearMiddle = (0.5 + 0.5 * Math.cos(longitude * radians)) ** 1.6
		const latitude = scatter * (3 + 5 * nearMiddle) * radians
		const along = longitude * radians
		clouds.push({
			place: [0, 1, 2].map(
				(axis) =>
					Math.cos(latitude) * (Math.cos(along) * middle[axis]! + Math.sin(along) * across[axis]!) +
					Math.sin(latitude) * pole[axis]!,
			),
			// How wide a cloud is, as the tangent of its angle, and how bright
			reach: Math.tan((4 + 6 * nearMiddle + 2 * Math.abs(scatter)) * radians),
			light: 0.016 + 0.042 * nearMiddle,
			warmth: nearMiddle,
		})
	}
	return clouds
})()

// The sky turns a quarter of a degree a minute: often enough to keep up
const KEEP_UP_MS = 30_000

export function StarField({map}: {map: MapLibreMap | undefined}) {
	const canvasRef = useRef<HTMLCanvasElement>(null)

	useEffect(() => {
		const canvas = canvasRef.current
		const context = canvas?.getContext('2d')
		if (!map || !canvas || !context) return
		let stars: Stars | undefined
		let frame = 0
		canvas.style.opacity = '0'

		const draw = () => {
			frame = 0
			if (!stars) return
			const scale = Math.min(2, window.devicePixelRatio || 1)
			// Laid exactly under the map, the canvas is the size the map is
			const {width, height} = viewSize(map)
			if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
				canvas.width = Math.round(width * scale)
				canvas.height = Math.round(height * scale)
			}
			const camera = mapCamera(map)
			const {origin, focal, radius} = camera
			// The globe's edge, as far from the middle of it as the camera sees it:
			// once that is past every corner there is no sky left to draw, and the
			// canvas is taken out of the page, not left a clear sheet under the map
			const edge = (focal * radius) / Math.sqrt((radius + focal) ** 2 - radius ** 2)
			const corner = Math.hypot(Math.max(origin.x, width - origin.x), Math.max(origin.y, height - origin.y))
			const covered = camera.globeness === 0 || edge > corner
			canvas.style.visibility = covered ? 'hidden' : ''
			if (covered) return
			// They come up out of the dark the first time they are drawn
			canvas.style.opacity = '1'
			context.setTransform(scale, 0, 0, scale, 0, 0)
			context.clearRect(0, 0, width, height)

			// The camera's axes among the stars: the Earth's, turned with the sky
			const turn = (skyTurn(Date.now()) * Math.PI) / 180
			const [cos, sin] = [Math.cos(turn), Math.sin(turn)]
			const turned = ([x, y, z]: number[]) => [x! * cos - y! * sin, x! * sin + y! * cos, z!]
			const [out, east, north] = [turned(camera.out), turned(camera.east), turned(camera.north)]
			for (const cloud of GALAXY) {
				const [x, y, z] = cloud.place as [number, number, number]
				const ahead = -(x * out[0]! + y * out[1]! + z * out[2]!)
				if (ahead < 0.3) continue
				const left = origin.x + (focal * (x * east[0]! + y * east[1]! + z * east[2]!)) / ahead
				const top = origin.y - (focal * (x * north[0]! + y * north[1]! + z * north[2]!)) / ahead
				const reach = (focal * cloud.reach) / ahead
				if (left < -reach || top < -reach || left > width + reach || top > height + reach) continue
				// Blue-white in its arms, and the warmer for being nearer its middle
				const tone = `${Math.round(196 + 44 * cloud.warmth)} ${Math.round(208 + 16 * cloud.warmth)} ${Math.round(255 - 40 * cloud.warmth)}`
				const glow = context.createRadialGradient(left, top, 0, left, top, reach)
				glow.addColorStop(0, `rgb(${tone} / ${cloud.light})`)
				glow.addColorStop(0.45, `rgb(${tone} / ${cloud.light * 0.45})`)
				glow.addColorStop(1, `rgb(${tone} / 0)`)
				context.fillStyle = glow
				context.fillRect(left - reach, top - reach, reach * 2, reach * 2)
			}

			const {place} = stars
			for (let index = 0; index < stars.count; index++) {
				const [x, y, z] = [place[index * 3]!, place[index * 3 + 1]!, place[index * 3 + 2]!]
				// The camera looks down at the Earth, and past it: those are its stars
				const ahead = -(x * out[0]! + y * out[1]! + z * out[2]!)
				if (ahead < 0.2) continue
				const left = origin.x + (focal * (x * east[0]! + y * east[1]! + z * east[2]!)) / ahead
				const top = origin.y - (focal * (x * north[0]! + y * north[1]! + z * north[2]!)) / ahead
				if (left < -8 || top < -8 || left > width + 8 || top > height + 8) continue
				// Behind the globe: it would be covered, so it needn't be drawn
				if (Math.hypot(left - origin.x, top - origin.y) < edge - 4) continue
				const size = stars.radius[index]!
				const colour = stars.colour[index]!
				// The brightest have a little light around them, fading out
				if (size > 1.5) {
					const reach = size * 4.5
					const light = context.createRadialGradient(left, top, 0, left, top, reach)
					light.addColorStop(0, colour.replace(')', ' / 0.32)'))
					light.addColorStop(1, colour.replace(')', ' / 0)'))
					context.globalAlpha = 1
					context.fillStyle = light
					context.fillRect(left - reach, top - reach, reach * 2, reach * 2)
				}
				context.fillStyle = colour
				context.globalAlpha = stars.alpha[index]!
				context.beginPath()
				context.arc(left, top, size, 0, 2 * Math.PI)
				context.fill()
			}
			context.globalAlpha = 1

			// The moon, where it is in the sky, as much of it lit as is, and lit
			// from the side the sun is on. A little larger than life, to be made out.
			const now = Date.now()
			const [moon, sun] = [moonOverhead(now), sunOverhead(now)]
			const [towards, towardsSun] = [direction(moon.lng, moon.lat), direction(sun.lng, sun.lat)]
			const along = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
			const ahead = -along(towards, camera.out)
			if (ahead > 0.3) {
				const left = origin.x + (focal * along(towards, camera.east)) / ahead
				const top = origin.y - (focal * along(towards, camera.north)) / ahead
				const size = Math.max(7, focal * Math.tan((0.26 * Math.PI) / 180) * 1.6)
				if (left > -size && top > -size && left < width + size && top < height + size) {
					const between = along(towards, towardsSun)
					const lit = (1 - between) / 2
					const sunward = towardsSun.map((part, axis) => part - towards[axis]! * between)
					context.save()
					context.translate(left, top)
					context.rotate(Math.atan2(-along(sunward, camera.north), along(sunward, camera.east)))
					const glow = context.createRadialGradient(0, 0, size * 0.6, 0, 0, size * 6)
					glow.addColorStop(0, `rgb(226 232 255 / ${0.05 + 0.2 * lit})`)
					glow.addColorStop(1, 'rgb(226 232 255 / 0)')
					context.fillStyle = glow
					context.fillRect(-size * 6, -size * 6, size * 12, size * 12)
					// Its dark side, by the light the Earth sends back to it
					context.fillStyle = 'rgb(30 35 48)'
					context.beginPath()
					context.arc(0, 0, size, 0, 2 * Math.PI)
					context.fill()
					// Its lit side: the edge towards the sun, and the line of its own
					// sunrise, which is half an ellipse, bulging one way or the other
					context.fillStyle = 'rgb(240 238 228)'
					context.beginPath()
					context.arc(0, 0, size, -Math.PI / 2, Math.PI / 2)
					context.ellipse(0, 0, size * Math.abs(1 - 2 * lit), size, 0, Math.PI / 2, -Math.PI / 2, lit < 0.5)
					context.fill()
					context.restore()
				}
			}
		}
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(draw)
		}

		let current = true
		loadStars().then(
			(loaded) => {
				if (!current) return
				stars = loaded
				schedule()
			},
			() => undefined,
		)
		map.on('move', schedule)
		map.on('resize', schedule)
		const keepingUp = setInterval(schedule, KEEP_UP_MS)
		return () => {
			current = false
			cancelAnimationFrame(frame)
			clearInterval(keepingUp)
			map.off('move', schedule)
			map.off('resize', schedule)
		}
	}, [map])

	return (
		<canvas
			ref={canvasRef}
			aria-hidden
			className='pointer-events-none absolute inset-0 size-full transition-opacity duration-700 ease-out motion-reduce:transition-none'
		/>
	)
}
