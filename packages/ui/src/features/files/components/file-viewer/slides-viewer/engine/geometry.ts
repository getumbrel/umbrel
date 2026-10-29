// Shape outlines. Preset shapes are ECMA-376's own definitions (presets.ts), written in the same guide language as
// custom geometry, so one evaluator draws both: guides are computed for the shape's size in EMU, then each path
// becomes px segments. Formulas can't loop and every count is capped, so hostile geometry stays cheap.

import {attr, child, children, type XmlElement} from '@/features/files/components/file-viewer/shared/xml'
import {PRESETS} from '@/features/files/components/file-viewer/slides-viewer/engine/presets'

export type PathFill = 'norm' | 'none' | 'lighten' | 'lightenLess' | 'darken' | 'darkenLess'
// Arcs are elliptical arcs of at most a quarter turn: radii, sweep direction (1 clockwise), end point
export type Segment =
	| {op: 'M' | 'L'; to: [number, number]}
	| {op: 'Q'; c: [number, number]; to: [number, number]}
	| {op: 'C'; c1: [number, number]; c2: [number, number]; to: [number, number]}
	| {op: 'A'; r: [number, number]; sweep: 0 | 1; to: [number, number]}
	| {op: 'Z'}
// `closed` paths take no arrowheads
export type ShapePath = {segments: Segment[]; fill: PathFill; stroke: boolean; closed: boolean}
export type Geometry = {paths: ShapePath[]; text: {x: number; y: number; w: number; h: number}}

type Command = {op: string; args: string[]}
type PathDefinition = {w: number; h: number; fill: PathFill; stroke: boolean; commands: Command[]}
type Definition = {guides: Array<[name: string, formula: string]>; rect?: string[]; paths: PathDefinition[]}

const EMU_PER_PX = 9525
const MAX_GUIDES = 4096
const MAX_COMMANDS = 65536
const TO_RADIANS = Math.PI / 180 / 60000

const FLAGS = new Map<string, Partial<PathDefinition>>([
	['!F', {fill: 'none'}],
	['!S', {stroke: false}],
	['!d', {fill: 'darken'}],
	['!D', {fill: 'darkenLess'}],
	['!l', {fill: 'lighten'}],
	['!L', {fill: 'lightenLess'}],
])
const ARITY = new Map([
	['M', 2],
	['L', 2],
	['A', 4],
	['Q', 4],
	['C', 6],
	['Z', 0],
])
const COMMANDS = new Map([
	['moveTo', 'M'],
	['lnTo', 'L'],
	['arcTo', 'A'],
	['quadBezTo', 'Q'],
	['cubicBezTo', 'C'],
	['close', 'Z'],
])
const FILLS = new Set(['norm', 'none', 'lighten', 'lightenLess', 'darken', 'darkenLess'])

const presets = new Map<string, Definition>()

// `adjust` is the shape's own avLst, overriding the preset's defaults; unknown presets give undefined
export function presetGeometry(name: string, w: number, h: number, adjust?: XmlElement): Geometry | undefined {
	if (!Object.hasOwn(PRESETS, name)) return undefined
	let definition = presets.get(name)
	if (!definition) presets.set(name, (definition = parsePreset(PRESETS[name])))
	const overrides = new Map<string, string>()
	for (const gd of adjust ? children(adjust, 'gd') : []) overrides.set(attr(gd, 'name') ?? '', attr(gd, 'fmla') ?? '')
	return evaluate(definition, w, h, overrides)
}

export function customGeometry(element: XmlElement, w: number, h: number): Geometry {
	const guides: Definition['guides'] = []
	for (const list of ['avLst', 'gdLst']) {
		const parent = child(element, list)
		for (const gd of parent ? children(parent, 'gd') : []) guides.push([attr(gd, 'name') ?? '', attr(gd, 'fmla') ?? ''])
	}
	const paths: PathDefinition[] = []
	const pathList = child(element, 'pathLst')
	for (const path of pathList ? children(pathList, 'path') : []) {
		const commands: Command[] = []
		for (const node of children(path)) {
			const op = COMMANDS.get(node.local)
			if (op === 'A') {
				commands.push({op, args: ['wR', 'hR', 'stAng', 'swAng'].map((name) => attr(node, name) ?? '0')})
				continue
			}
			const points = children(node, 'pt').flatMap((pt) => [attr(pt, 'x') ?? '0', attr(pt, 'y') ?? '0'])
			const arity = op ? ARITY.get(op)! : -1
			if (op && points.length >= arity) commands.push({op, args: points.slice(0, arity)})
		}
		const fill = attr(path, 'fill') ?? 'norm'
		const stroke = attr(path, 'stroke')
		paths.push({
			w: Number(attr(path, 'w') ?? 0),
			h: Number(attr(path, 'h') ?? 0),
			fill: FILLS.has(fill) ? (fill as PathFill) : 'norm',
			stroke: stroke !== 'false' && stroke !== '0',
			commands,
		})
	}
	// A missing side falls back to the shape's own edge, which the built-in guide of the same name is
	const rect = child(element, 'rect')
	const sides = rect && ['l', 't', 'r', 'b'].map((side) => attr(rect, side) ?? side)
	return evaluate({guides, rect: sides, paths}, w, h, new Map())
}

function parsePreset(source: string): Definition {
	const [guides, rect, ...paths] = source.split('|')
	return {
		guides: guides ? guides.split(';').map(parseGuide) : [],
		rect: rect ? rect.split(' ') : undefined,
		paths: paths.map((path) => {
			const tokens = path.split(' ')
			const definition: PathDefinition = {w: 0, h: 0, fill: 'norm', stroke: true, commands: []}
			let i = 0
			for (; tokens[i]?.[0] === '@' || tokens[i]?.[0] === '!'; i++) {
				if (tokens[i][0] === '!') Object.assign(definition, FLAGS.get(tokens[i]))
				else [definition.w, definition.h] = tokens[i].slice(1).split(',').map(Number)
			}
			while (i < tokens.length) {
				const op = tokens[i++]
				const arity = ARITY.get(op) ?? 0
				definition.commands.push({op, args: tokens.slice(i, i + arity)})
				i += arity
			}
			return definition
		}),
	}
}

function parseGuide(guide: string): [string, string] {
	const equals = guide.indexOf('=')
	if (equals >= 0) return [guide.slice(0, equals), `val ${guide.slice(equals + 1)}`]
	const space = guide.indexOf(' ')
	return [guide.slice(0, space), guide.slice(space + 1)]
}

function evaluate(definition: Definition, w: number, h: number, overrides: Map<string, string>): Geometry {
	const values = new Map<string, number>()
	const value = (token: string) => {
		const number = Number(token)
		return Number.isNaN(number) ? (values.get(token) ?? builtin(token, w, h)) : number
	}
	for (const [name, formula] of definition.guides.slice(0, MAX_GUIDES)) {
		values.set(name, compute(overrides.get(name) ?? formula, value))
	}

	const paths: ShapePath[] = []
	let budget = MAX_COMMANDS
	for (const path of definition.paths) {
		// A path with its own w/h is drawn in that space and stretched over the shape
		const kx = (path.w > 0 ? w / path.w : 1) / EMU_PER_PX
		const ky = (path.h > 0 ? h / path.h : 1) / EMU_PER_PX
		const point = (x: number, y: number): [number, number] => [px(x * kx), px(y * ky)]
		const segments: Segment[] = []
		let [x, y, startX, startY] = [0, 0, 0, 0]
		let closed = false
		for (const {op, args} of path.commands) {
			if (--budget < 0) break
			const [a, b, c, d, e, f] = args.map(value)
			if (op === 'M' || op === 'L') {
				;[x, y] = [a, b]
				if (op === 'M') [startX, startY] = [a, b]
				segments.push({op, to: point(a, b)})
			} else if (op === 'Q') {
				;[x, y] = [c, d]
				segments.push({op, c: point(a, b), to: point(c, d)})
			} else if (op === 'C') {
				;[x, y] = [e, f]
				segments.push({op, c1: point(a, b), c2: point(c, d), to: point(e, f)})
			} else if (op === 'A') {
				;[x, y] = arc(segments, x, y, a, b, c, d, kx, ky)
			} else if (op === 'Z') {
				segments.push({op})
				;[x, y] = [startX, startY]
				closed = true
			}
		}
		if (segments.length) paths.push({segments, fill: path.fill, stroke: path.stroke, closed})
	}

	const [l, t, r, b] = (definition.rect ?? ['l', 't', 'r', 'b']).map(value)
	const text = {
		x: l / EMU_PER_PX,
		y: t / EMU_PER_PX,
		w: Math.max(0, r - l) / EMU_PER_PX,
		h: Math.max(0, b - t) / EMU_PER_PX,
	}
	return {paths, text}
}

// An arc continues from the pen, which sits on the ellipse at the start angle. Angles are polar (seen from the
// centre), so they're converted to the ellipse's parametric angles before finding the centre and end point, and
// the sweep is cut into quarter turns so SVG never has to choose between two arcs.
function arc(
	out: Segment[],
	x: number,
	y: number,
	wR: number,
	hR: number,
	stAng: number,
	swAng: number,
	kx: number,
	ky: number,
) {
	const sweep = Math.max(-2 * Math.PI, Math.min(2 * Math.PI, swAng * TO_RADIANS))
	const start = stAng * TO_RADIANS
	const t1 = parametric(start, wR, hR)
	const t2 = parametric(start + sweep, wR, hR)
	const cx = x - wR * Math.cos(t1)
	const cy = y - hR * Math.sin(t1)
	const steps = Math.max(1, Math.ceil(Math.abs(t2 - t1) / (Math.PI / 2) - 1e-9))
	let [endX, endY] = [x, y]
	for (let i = 1; i <= steps; i++) {
		const t = t1 + ((t2 - t1) * i) / steps
		endX = cx + wR * Math.cos(t)
		endY = cy + hR * Math.sin(t)
		out.push({
			op: 'A',
			r: [px(Math.abs(wR * kx)), px(Math.abs(hR * ky))],
			sweep: sweep > 0 ? 1 : 0,
			to: [px(endX * kx), px(endY * ky)],
		})
	}
	return [endX, endY]
}

// The parametric angle of the point at polar angle `angle`, lifted to the same turn so sweeps stay continuous
function parametric(angle: number, wR: number, hR: number) {
	if (!wR || !hR) return angle
	const base = Math.atan2(wR * Math.sin(angle), hR * Math.cos(angle))
	return base + 2 * Math.PI * Math.round((angle - base) / (2 * Math.PI))
}

const CONSTANTS = new Map([
	['l', 0],
	['t', 0],
	['cd2', 10800000],
	['cd4', 5400000],
	['cd8', 2700000],
	['3cd4', 16200000],
	['3cd8', 8100000],
	['5cd8', 13500000],
	['7cd8', 18900000],
])

function builtin(name: string, w: number, h: number): number {
	const constant = CONSTANTS.get(name)
	if (constant !== undefined) return constant
	switch (name) {
		case 'w':
		case 'r':
			return w
		case 'h':
		case 'b':
			return h
		case 'hc':
			return w / 2
		case 'vc':
			return h / 2
		case 'ss':
			return Math.min(w, h)
		case 'ls':
			return Math.max(w, h)
	}
	// wd2, hd4, ssd8, … and the wd12/wd32 the definitions use beyond the spec's list
	const fraction = /^(wd|hd|ssd)([1-9][0-9]*)$/.exec(name)
	if (!fraction) return 0
	return (fraction[1] === 'wd' ? w : fraction[1] === 'hd' ? h : Math.min(w, h)) / Number(fraction[2])
}

function compute(formula: string, value: (token: string) => number): number {
	const [op, ...tokens] = formula.trim().split(/\s+/)
	const [x = 0, y = 0, z = 0] = tokens.slice(0, 3).map(value)
	let result: number
	switch (op) {
		case 'val':
			result = x
			break
		case '*/':
			result = z ? (x * y) / z : 0
			break
		case '+-':
			result = x + y - z
			break
		case '+/':
			result = z ? (x + y) / z : 0
			break
		case '?:':
			result = x > 0 ? y : z
			break
		case 'abs':
			result = Math.abs(x)
			break
		case 'at2':
			result = Math.atan2(y, x) / TO_RADIANS
			break
		case 'cat2':
			result = x * Math.cos(Math.atan2(z, y))
			break
		case 'sat2':
			result = x * Math.sin(Math.atan2(z, y))
			break
		case 'cos':
			result = x * Math.cos(y * TO_RADIANS)
			break
		case 'sin':
			result = x * Math.sin(y * TO_RADIANS)
			break
		case 'tan':
			result = x * Math.tan(y * TO_RADIANS)
			break
		case 'max':
			result = Math.max(x, y)
			break
		case 'min':
			result = Math.min(x, y)
			break
		case 'mod':
			result = Math.sqrt(x * x + y * y + z * z)
			break
		case 'pin':
			result = y < x ? x : y > z ? z : y
			break
		case 'sqrt':
			result = Math.sqrt(Math.max(0, x))
			break
		default:
			result = 0
	}
	return Number.isFinite(result) ? result : 0
}

// Two decimals of a px is finer than any screen, and keeps path data short
const px = (value: number) => {
	const rounded = Math.round(Math.max(-1e7, Math.min(1e7, value)) * 100) / 100
	return rounded === 0 ? 0 : rounded
}

export function pathData(path: ShapePath): string {
	return path.segments
		.map((s) => {
			switch (s.op) {
				case 'M':
				case 'L':
					return `${s.op}${s.to[0]} ${s.to[1]}`
				case 'Q':
					return `Q${s.c[0]} ${s.c[1]} ${s.to[0]} ${s.to[1]}`
				case 'C':
					return `C${s.c1[0]} ${s.c1[1]} ${s.c2[0]} ${s.c2[1]} ${s.to[0]} ${s.to[1]}`
				case 'A':
					return `A${s.r[0]} ${s.r[1]} 0 0 ${s.sweep} ${s.to[0]} ${s.to[1]}`
				case 'Z':
					return 'Z'
			}
		})
		.join('')
}

// Pulls an open path's ends in by `start` and `end` px along their tangents, so a line stops inside its
// arrowheads instead of poking through their tips. Ends that are arcs are left alone.
export function trimPath(path: ShapePath, start: number, end: number): ShapePath {
	if (path.closed || (!start && !end)) return path
	const segments = path.segments.map((s) => structuredClone(s))
	const move = (p: [number, number], toward: [number, number], by: number) => {
		const dx = toward[0] - p[0]
		const dy = toward[1] - p[1]
		const length = Math.hypot(dx, dy)
		if (!length) return false
		// Never trim more than most of the segment: a short line keeps a stub between its arrowheads
		const k = Math.min(by, length * 0.45) / length
		p[0] = px(p[0] + dx * k)
		p[1] = px(p[1] + dy * k)
		return true
	}
	const first = segments[0]
	const second = segments[1]
	if (start && first?.op === 'M' && second && second.op !== 'A' && second.op !== 'Z' && second.op !== 'M') {
		const toward = second.op === 'Q' ? second.c : second.op === 'C' ? second.c1 : second.to
		const anchor: [number, number] = [first.to[0], first.to[1]]
		if (move(first.to, toward, start) && second.op === 'C') {
			second.c1 = [px(second.c1[0] + first.to[0] - anchor[0]), px(second.c1[1] + first.to[1] - anchor[1])]
		}
	}
	const last = segments.at(-1)
	// Measured against the untrimmed path, so trimming the start of a one-segment line doesn't shorten its end's limit
	const previous = path.segments.length > 1 ? path.segments.at(-2) : undefined
	if (end && last && previous && previous.op !== 'Z' && (last.op === 'L' || last.op === 'Q' || last.op === 'C')) {
		const from = last.op === 'Q' ? last.c : last.op === 'C' ? last.c2 : previous.to
		const anchor: [number, number] = [last.to[0], last.to[1]]
		if (move(last.to, from, end) && last.op === 'C') {
			last.c2 = [px(last.c2[0] + last.to[0] - anchor[0]), px(last.c2[1] + last.to[1] - anchor[1])]
		}
	}
	return {...path, segments}
}
