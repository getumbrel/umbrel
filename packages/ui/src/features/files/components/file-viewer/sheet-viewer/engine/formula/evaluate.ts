// Formulas are bound once to their workbook (sheet names, defined names and
// functions resolved, precedents collected) and then evaluated as often as
// their inputs change. Operators and single-value function arguments take
// arrays element by element, as in Excel 365.

import {FUNCTIONS} from './functions'
import {FormulaSyntaxError, type Ast, type BinaryOperator} from './parser'
import {
	Areas,
	arithmetic,
	broadcast,
	isArray,
	isMatrix,
	kindAt,
	operand,
	Ref,
	single,
	type Context,
	type Fn,
	type Matrix,
	type Operator,
	type Result,
} from './runtime'
import {compareValues, errorFromCode, Errors, isError, text, toNumber, toText, type Value} from './values'

export type Node =
	| {kind: 'value'; value: Value}
	| {kind: 'ref'; ref: Ref}
	| {kind: 'array'; matrix: Matrix}
	| {kind: 'call'; fn: Fn; args: Node[]}
	| {kind: 'unary'; operator: '+' | '-' | '%'; operand: Node}
	// a op b op c..., evaluated left to right without recursing down the chain,
	// so a 4000-term A1+A2+... can't overflow the stack
	| {kind: 'chain'; first: Node; operators: BinaryOperator[]; operands: Node[]}
	| {kind: 'union'; areas: Node[]}
	| {kind: 'missing'}

export type NameTarget = {value: Value} | {ref: Ref} | 'unsupported'

export type Scope = {
	// The formula's sheet, for references without a sheet name
	sheet: number
	sheetIndex(name: string): number | undefined
	name(name: string): NameTarget | undefined
}

export type Bound = {
	node: Node
	// Every area the result can depend on
	precedents: Ref[]
	// Uses something we can't calculate; the cell keeps its cached value
	unsupported: boolean
	volatile: boolean
}

// Precedence levels whose operators chain left to right
const LEVEL: Record<BinaryOperator, number> = {
	'=': 1,
	'<>': 1,
	'<': 1,
	'<=': 1,
	'>': 1,
	'>=': 1,
	'&': 2,
	'+': 3,
	'-': 3,
	'*': 4,
	'/': 4,
	'^': 5,
	' ': 8,
	':': 9,
}

// Throws FormulaSyntaxError when a function gets the wrong number of arguments
export function bind(ast: Ast, scope: Scope): Bound {
	const precedents: Ref[] = []
	let unsupported = false
	let volatile = false
	const node = visit(ast)
	return {node, precedents, unsupported, volatile}

	function visit(ast: Ast): Node {
		switch (ast.type) {
			case 'number':
			case 'string':
			case 'boolean':
				return {kind: 'value', value: ast.value}
			case 'error':
				return {kind: 'value', value: errorFromCode(ast.value)!}
			case 'missing':
				return {kind: 'missing'}
			case 'array':
				return {kind: 'array', matrix: ast.rows}
			case 'unsupported':
				unsupported = true
				return {kind: 'value', value: Errors.value}
			case 'ref': {
				const sheet = ast.sheet === undefined ? scope.sheet : scope.sheetIndex(ast.sheet)
				if (sheet === undefined) return {kind: 'value', value: Errors.ref}
				const {top, left, bottom, right} = ast.area
				const ref = new Ref(sheet, top, left, bottom, right)
				precedents.push(ref)
				return {kind: 'ref', ref}
			}
			case 'name': {
				const target = scope.name(ast.name)
				if (target === undefined) return {kind: 'value', value: Errors.name}
				if (target === 'unsupported') {
					unsupported = true
					return {kind: 'value', value: Errors.name}
				}
				if ('value' in target) return {kind: 'value', value: target.value}
				precedents.push(target.ref)
				return {kind: 'ref', ref: target.ref}
			}
			case 'unary':
				return {kind: 'unary', operator: ast.operator, operand: visit(ast.operand)}
			case 'union':
				return {kind: 'union', areas: ast.areas.map(visit)}
			case 'call': {
				const args = ast.args.map(visit)
				const fn = FUNCTIONS.get(ast.name)
				if (!fn) {
					unsupported = true
					return {kind: 'value', value: Errors.name}
				}
				if (args.length < fn.min || args.length > fn.max) {
					throw new FormulaSyntaxError(`${ast.name} can't take ${args.length} arguments`, 0)
				}
				if (fn.volatile) volatile = true
				return {kind: 'call', fn, args}
			}
			case 'binary': {
				// Walk down the left spine iteratively, gathering one level's chain
				const level = LEVEL[ast.operator]
				const spine: Extract<Ast, {type: 'binary'}>[] = []
				let left: Ast = ast
				while (left.type === 'binary' && LEVEL[left.operator] === level) {
					spine.push(left)
					left = left.left
				}
				const from = precedents.length
				const first = visit(left)
				const operators: BinaryOperator[] = []
				const operands: Node[] = []
				for (let i = spine.length - 1; i >= 0; i--) {
					operators.push(spine[i].operator)
					operands.push(visit(spine[i].right))
				}
				// A1:INDEX(B1:B9, 3) spans cells neither side names; the bounding box
				// of every reference inside covers whatever it resolves to
				if (level === LEVEL[':']) precedents.push(...boundingBoxes(precedents.slice(from)))
				return {kind: 'chain', first, operators, operands}
			}
		}
	}
}

function boundingBoxes(refs: Ref[]): Ref[] {
	const boxes = new Map<number, Ref>()
	for (const ref of refs) {
		const box = boxes.get(ref.sheet) ?? ref
		boxes.set(
			ref.sheet,
			new Ref(
				ref.sheet,
				Math.min(box.top, ref.top),
				Math.min(box.left, ref.left),
				Math.max(box.bottom, ref.bottom),
				Math.max(box.right, ref.right),
			),
		)
	}
	return [...boxes.values()]
}

function evaluate(node: Node, cx: Context): Result {
	switch (node.kind) {
		case 'value':
			return node.value
		case 'ref':
			return node.ref
		case 'array':
			return node.matrix
		case 'missing':
			return null
		case 'unary':
			return unary(node.operator, evaluate(node.operand, cx), cx)
		case 'chain':
			return chain(node, cx, false)
		case 'union':
			return union(node.areas.map((area) => evaluate(area, cx)))
		case 'call':
			return call(node.fn, node.args, cx)
	}
}

// A formula whose last step is + or - and lands within rounding noise of zero
// shows 0 in Excel (=0.5-0.4-0.1 is 0, not 2.8E-17); Excel does this for the
// final operation only, so SUM and inner steps keep their noise
export function evaluateFormula(node: Node, cx: Context): Result {
	return node.kind === 'chain' ? chain(node, cx, true) : evaluate(node, cx)
}

function chain(node: Extract<Node, {kind: 'chain'}>, cx: Context, snap: boolean): Result {
	let result = evaluate(node.first, cx)
	const last = node.operators.length - 1
	for (let i = 0; i <= last; i++) {
		result = binary(node.operators[i], result, evaluate(node.operands[i], cx), cx, snap && i === last)
	}
	return result
}

function binary(operator: BinaryOperator, a: Result, b: Result, cx: Context, snap: boolean): Result {
	if (operator === ':' || operator === ' ') {
		if (isError(a)) return a
		if (isError(b)) return b
		if (!(a instanceof Ref) || !(b instanceof Ref) || a.sheet !== b.sheet) return Errors.value
		return operator === ':' ? span(a, b) : intersect(a, b)
	}
	const x = operand(a, cx)
	const y = operand(b, cx)
	if (isMatrix(x) || isMatrix(y)) return broadcast([x, y], ([p, q]) => scalar(operator, p, q, cx, snap))
	return scalar(operator, x, y, cx, snap)
}

function scalar(operator: BinaryOperator, a: Value, b: Value, cx: Context, snap: boolean): Value {
	if (isError(a)) return a
	if (isError(b)) return b
	switch (operator) {
		case '&': {
			const left = toText(a)
			if (isError(left)) return left
			const right = toText(b)
			return isError(right) ? right : text(left + right)
		}
		case '=':
			return compareValues(a, b) === 0
		case '<>':
			return compareValues(a, b) !== 0
		case '<':
			return compareValues(a, b) < 0
		case '<=':
			return compareValues(a, b) <= 0
		case '>':
			return compareValues(a, b) > 0
		case '>=':
			return compareValues(a, b) >= 0
	}
	const x = toNumber(a, cx)
	if (isError(x)) return x
	const y = toNumber(b, cx)
	if (isError(y)) return y
	return arithmetic(operator as Operator, x, y, snap)
}

function unary(operator: '+' | '-' | '%', result: Result, cx: Context): Result {
	// Unary plus changes nothing, not even the type: =+"a" is "a"
	if (operator === '+') return result
	const apply = (value: Value): Value => {
		if (isError(value)) return value
		const n = toNumber(value, cx)
		if (isError(n)) return n
		return operator === '-' ? 0 - n : n / 100
	}
	const x = operand(result, cx)
	return isMatrix(x) ? broadcast([x], ([value]) => apply(value)) : apply(x)
}

const span = (a: Ref, b: Ref) =>
	new Ref(
		a.sheet,
		Math.min(a.top, b.top),
		Math.min(a.left, b.left),
		Math.max(a.bottom, b.bottom),
		Math.max(a.right, b.right),
	)

function intersect(a: Ref, b: Ref): Result {
	const top = Math.max(a.top, b.top)
	const left = Math.max(a.left, b.left)
	const bottom = Math.min(a.bottom, b.bottom)
	const right = Math.min(a.right, b.right)
	return top > bottom || left > right ? Errors.null : new Ref(a.sheet, top, left, bottom, right)
}

function union(results: Result[]): Result {
	const refs: Ref[] = []
	for (const result of results) {
		if (result instanceof Ref) refs.push(result)
		else if (result instanceof Areas) refs.push(...result.refs)
		else return isError(result) ? result : Errors.value
	}
	return refs.every((ref) => ref.sheet === refs[0].sheet) ? new Areas(refs) : Errors.value
}

function call(fn: Fn, nodes: Node[], cx: Context): Result {
	if (fn.lazy) return fn.lazy(nodes.length, (i) => evaluate(nodes[i], cx), cx)
	const args: Result[] = new Array(nodes.length)
	for (let i = 0; i < nodes.length; i++) args[i] = evaluate(nodes[i], cx)
	return invoke(fn, args, cx)
}

// Calls fn, once per element when a single-value argument gets an array or a block of cells
function invoke(fn: Fn, args: Result[], cx: Context): Result {
	const lifted: number[] = []
	const operands: Matrix[] = []
	for (let i = 0; i < args.length; i++) {
		if (kindAt(fn, i) !== 's') continue
		const x = operand(args[i], cx)
		if (isArray(x)) {
			lifted.push(i)
			operands.push(x)
		} else args[i] = isMatrix(x) ? x[0][0] : x
	}
	if (lifted.length === 0) return settle(fn.call!(args, cx))
	return broadcast(operands, (values) => {
		const each = args.slice()
		for (let k = 0; k < lifted.length; k++) each[lifted[k]] = values[k]
		return single(settle(fn.call!(each, cx)), cx)
	})
}

// Functions never hand back NaN or Infinity
const settle = (result: Result): Result =>
	typeof result === 'number' && !Number.isFinite(result) ? Errors.num : result
