import {columnName, MAX_COLS, MAX_ROWS, tokenize, type RefToken} from './parser'

// The formula as if copied `delta` rows down and columns right: relative parts
// of references move, $-fixed parts stay, and a reference pushed off the sheet
// becomes #REF!. Only reference text changes; everything else, spacing and
// case included, is kept byte for byte. This is how an XLSX shared formula's
// master text becomes each member cell's formula.
export function shiftFormula(text: string, delta: {rows: number; cols: number}): string {
	if (delta.rows === 0 && delta.cols === 0) return text
	let out = ''
	let copied = 0
	for (const token of tokenize(text)) {
		if (token.kind !== 'ref') continue
		const shifted = shiftReference(token, delta)
		if (shifted === undefined) continue
		out += text.slice(copied, token.refStart) + shifted
		copied = token.end
	}
	return copied === 0 ? text : out + text.slice(copied)
}

function shiftReference({form, area, fixed}: RefToken, {rows, cols}: {rows: number; cols: number}): string | undefined {
	const moveRows = form !== 'columns' && rows !== 0 && !(fixed.top && fixed.bottom)
	const moveCols = form !== 'rows' && cols !== 0 && !(fixed.left && fixed.right)
	if (!moveRows && !moveCols) return undefined
	const top = area.top + (fixed.top || form === 'columns' ? 0 : rows)
	const bottom = area.bottom + (fixed.bottom || form === 'columns' ? 0 : rows)
	const left = area.left + (fixed.left || form === 'rows' ? 0 : cols)
	const right = area.right + (fixed.right || form === 'rows' ? 0 : cols)
	if (Math.min(top, bottom) < 0 || Math.max(top, bottom) >= MAX_ROWS) return '#REF!'
	if (Math.min(left, right) < 0 || Math.max(left, right) >= MAX_COLS) return '#REF!'
	const col = (value: number, isFixed: boolean) => (isFixed ? '$' : '') + columnName(value)
	const row = (value: number, isFixed: boolean) => (isFixed ? '$' : '') + (value + 1)
	switch (form) {
		case 'cell':
			return col(left, fixed.left) + row(top, fixed.top)
		case 'range':
			return `${col(left, fixed.left)}${row(top, fixed.top)}:${col(right, fixed.right)}${row(bottom, fixed.bottom)}`
		case 'columns':
			return `${col(left, fixed.left)}:${col(right, fixed.right)}`
		case 'rows':
			return `${row(top, fixed.top)}:${row(bottom, fixed.bottom)}`
	}
}
