import {describe, expect, test} from 'vitest'

import {parseXml} from '@/features/files/components/file-viewer/shared/xml'
import {
	customGeometry,
	pathData,
	presetGeometry,
	trimPath,
	type Segment,
	type ShapePath,
} from '@/features/files/components/file-viewer/slides-viewer/engine/geometry'
import {PRESETS} from '@/features/files/components/file-viewer/slides-viewer/engine/presets'

const PX = 9525
// Geometry for a w×h px shape
const preset = (name: string, w: number, h: number, adjust?: string) =>
	presetGeometry(name, w * PX, h * PX, adjust ? parseXml(`<a:avLst>${adjust}</a:avLst>`) : undefined)!
const ends = (path: ShapePath) => path.segments.flatMap((s) => (s.op === 'Z' ? [] : [s.to]))
const last = (path: ShapePath) => ends(path).at(-1)!
const numbers = (segment: Segment) => Object.values(segment).flatMap((value) => (Array.isArray(value) ? value : []))

describe('presets', () => {
	test('every ECMA-376 preset draws finite paths at any size', () => {
		expect(Object.keys(PRESETS)).toHaveLength(186)
		for (const name of Object.keys(PRESETS)) {
			for (const [w, h] of [
				[200, 100],
				[100, 200],
				[37, 37],
				[300, 0],
				[0, 0],
				[1e6, 3],
			]) {
				const geometry = preset(name, w, h)
				expect(geometry.paths.length, name).toBeGreaterThan(0)
				for (const path of geometry.paths) {
					for (const segment of path.segments)
						expect(numbers(segment).every(Number.isFinite), `${name} ${w}×${h}`).toBe(true)
				}
				expect(Object.values(geometry.text).every(Number.isFinite), name).toBe(true)
			}
		}
	})

	test('rect and line', () => {
		expect(pathData(preset('rect', 200, 100).paths[0])).toBe('M0 0L200 0L200 100L0 100Z')
		const line = preset('line', 120, 0).paths[0]
		expect(pathData(line)).toBe('M0 0L120 0')
		expect(line.closed).toBe(false)
		// Connectors draw an outline only
		expect(preset('straightConnector1', 10, 10).paths[0].fill).toBe('none')
	})

	test('an ellipse is four quarter arcs through its extremes, with its text box inset at 45°', () => {
		const geometry = preset('ellipse', 200, 100)
		expect(ends(geometry.paths[0])).toEqual([
			[0, 50],
			[100, 0],
			[200, 50],
			[100, 100],
			[0, 50],
		])
		expect(
			geometry.paths[0].segments
				.filter((s) => s.op === 'A')
				.every((s) => s.op === 'A' && s.r[0] === 100 && s.r[1] === 50),
		).toBe(true)
		const inset = 100 * (1 - Math.cos(Math.PI / 4))
		expect(geometry.text.x).toBeCloseTo(inset, 5)
		expect(geometry.text.w).toBeCloseTo(200 - 2 * inset, 5)
		expect(geometry.text.h).toBeCloseTo(100 - 2 * 50 * (1 - Math.cos(Math.PI / 4)), 5)
	})

	test('adjust values default from the definition and are overridden by the shape', () => {
		// roundRect's corner radius is 16667/100000 of the shorter side
		const round = preset('roundRect', 200, 100).paths[0]
		expect(round.segments[0]).toEqual({op: 'M', to: [0, 16.67]})
		expect(preset('roundRect', 200, 100, '<a:gd name="adj" fmla="val 50000"/>').paths[0].segments[0]).toEqual({
			op: 'M',
			to: [0, 50],
		})
		// rightArrow: shaft height adj1 of h, head length adj2 of the shorter side
		const arrow = ends(
			preset('rightArrow', 200, 100, '<a:gd name="adj1" fmla="val 40000"/><a:gd name="adj2" fmla="val 30000"/>')
				.paths[0],
		)
		expect(arrow).toEqual([
			[0, 30],
			[170, 30],
			[170, 0],
			[200, 50],
			[170, 100],
			[170, 70],
			[0, 70],
		])
	})

	test('arc angles are polar: a pie wedge ends where its angle points on a stretched ellipse', () => {
		// 0° to 45°: the end sits on the ellipse along the 45° line from the centre, not at parameter 45°
		const wedge = preset('pie', 200, 100, '<a:gd name="adj1" fmla="val 0"/><a:gd name="adj2" fmla="val 2700000"/>')
			.paths[0]
		expect(wedge.segments[0]).toEqual({op: 'M', to: [200, 50]})
		const arcEnd = wedge.segments.filter((s) => s.op === 'A').at(-1)!
		const [x, y] = arcEnd.op === 'A' ? arcEnd.to : [0, 0]
		expect(Math.atan2(y - 50, x - 100)).toBeCloseTo(Math.PI / 4, 3)
		expect(((x - 100) / 100) ** 2 + ((y - 50) / 50) ** 2).toBeCloseTo(1, 3)
		expect(last(wedge)).toEqual([100, 50])
		// The default pie is three quarters, swept clockwise in quarter turns
		const pie = preset('pie', 100, 100).paths[0]
		expect(pie.segments.filter((s) => s.op === 'A')).toHaveLength(3)
		expect(pie.segments.every((s) => s.op !== 'A' || s.sweep === 1)).toBe(true)
	})

	test('lighten and darken paths, and unknown presets', () => {
		expect(preset('can', 100, 100).paths.map((p) => p.fill)).toEqual(['norm', 'lighten', 'none'])
		expect(preset('can', 100, 100).paths.map((p) => p.stroke)).toEqual([false, false, true])
		expect(presetGeometry('notAShape', 1, 1)).toBeUndefined()
		expect(presetGeometry('constructor', 1, 1)).toBeUndefined()
		expect(presetGeometry('__proto__', 1, 1)).toBeUndefined()
	})
})

describe('custom geometry', () => {
	const custom = (xml: string, w: number, h: number) =>
		customGeometry(parseXml(`<a:custGeom>${xml}</a:custGeom>`), w * PX, h * PX)

	test('paths are stretched from their own coordinate space, guides see the shape size', () => {
		const geometry = custom(
			'<a:avLst/><a:gdLst><a:gd name="half" fmla="*/ w 1 2"/></a:gdLst><a:rect l="half" t="t" r="r" b="b"/>' +
				'<a:pathLst><a:path w="10" h="10"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="10" y="10"/></a:lnTo>' +
				'<a:cubicBezTo><a:pt x="10" y="0"/><a:pt x="5" y="0"/><a:pt x="0" y="5"/></a:cubicBezTo><a:close/></a:path>' +
				'<a:path fill="none" stroke="0"><a:moveTo><a:pt x="half" y="0"/></a:moveTo><a:quadBezTo><a:pt x="0" y="0"/><a:pt x="0" y="half"/></a:quadBezTo></a:path></a:pathLst>',
			100,
			50,
		)
		expect(pathData(geometry.paths[0])).toBe('M0 0L100 50C100 0 50 0 0 25Z')
		expect(geometry.paths[0].closed).toBe(true)
		// Unscaled paths are in the shape's own units: `half` is 50 px whichever axis it's used on
		expect(pathData(geometry.paths[1])).toBe('M50 0Q0 0 0 50')
		expect(geometry.paths[1]).toMatchObject({fill: 'none', stroke: false, closed: false})
		expect(geometry.text).toEqual({x: 50, y: 0, w: 50, h: 50})
	})

	test('arcs continue from the pen', () => {
		const geometry = custom(
			'<a:pathLst><a:path w="200" h="100"><a:moveTo><a:pt x="0" y="50"/></a:moveTo>' +
				'<a:arcTo wR="100" hR="50" stAng="10800000" swAng="10800000"/></a:path></a:pathLst>',
			200,
			100,
		)
		expect(last(geometry.paths[0])).toEqual([200, 50])
		expect(geometry.paths[0].segments.filter((s) => s.op === 'A')).toHaveLength(2)
	})

	test('hostile formulas and paths stay finite and bounded', () => {
		const guides = Array.from({length: 10000}, (_, i) => `<a:gd name="g${i}" fmla="*/ g${i - 1} 3 0"/>`).join('')
		const geometry = custom(
			`<a:gdLst>${guides}<a:gd name="x" fmla="sqrt -4"/><a:gd name="y" fmla="+/ 1 2 0"/><a:gd name="z" fmla="what 1 2 3"/></a:gdLst>` +
				'<a:pathLst><a:path><a:moveTo><a:pt x="x" y="y"/></a:moveTo><a:lnTo><a:pt x="z" y="1e400"/></a:lnTo>' +
				'<a:arcTo wR="10" hR="10" stAng="0" swAng="999999999999"/><a:lnTo><a:pt x="nope"/></a:lnTo></a:path></a:pathLst>',
			10,
			10,
		)
		const segments = geometry.paths[0].segments
		expect(segments.every((s) => numbers(s).every(Number.isFinite))).toBe(true)
		// A sweep beyond a full turn is one turn, in at most four quarter arcs
		expect(segments.filter((s) => s.op === 'A')).toHaveLength(4)
		expect(segments[0]).toEqual({op: 'M', to: [0, 0]})
	})

	test('a path with no commands draws nothing', () => {
		expect(custom('<a:pathLst><a:path/></a:pathLst>', 10, 10).paths).toEqual([])
		expect(custom('', 10, 10).text).toEqual({x: 0, y: 0, w: 10, h: 10})
	})
})

describe('trimming line ends for arrowheads', () => {
	const line = (d: Segment[]): ShapePath => ({segments: d, fill: 'none', stroke: true, closed: false})

	test('straight ends move along the line, never past most of it', () => {
		const path = line([
			{op: 'M', to: [0, 0]},
			{op: 'L', to: [100, 0]},
		])
		expect(pathData(trimPath(path, 10, 20))).toBe('M10 0L80 0')
		expect(pathData(trimPath(path, 0, 0))).toBe('M0 0L100 0')
		expect(pathData(trimPath(path, 500, 500))).toBe('M45 0L55 0')
		// The original is untouched
		expect(pathData(path)).toBe('M0 0L100 0')
	})

	test('curved ends keep their tangent; closed paths and arcs are left alone', () => {
		const curve = line([
			{op: 'M', to: [0, 0]},
			{op: 'C', c1: [0, 50], c2: [100, 50], to: [100, 100]},
		])
		expect(pathData(trimPath(curve, 10, 10))).toBe('M0 10C0 60 100 40 100 90')
		const closed = {...curve, closed: true}
		expect(trimPath(closed, 10, 10)).toBe(closed)
		const arc = line([
			{op: 'M', to: [0, 0]},
			{op: 'A', r: [10, 10], sweep: 1, to: [10, 10]},
		])
		expect(pathData(trimPath(arc, 5, 5))).toBe(pathData(arc))
	})
})
