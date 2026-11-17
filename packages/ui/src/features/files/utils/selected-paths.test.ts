import {expect, test} from 'vitest'

import type {FileSystemItem} from '@/features/files/types'

import {selectedPathsOf, selectionPositionOf} from './selected-paths'

const item = (name: string) => ({name, path: `/Home/${name}`}) as FileSystemItem

test('the set of selected paths is built once for a selection, and again for the next', () => {
	const selection = [item('a'), item('b')]
	const paths = selectedPathsOf(selection)
	expect([...paths]).toEqual(['/Home/a', '/Home/b'])
	expect(selectedPathsOf(selection)).toBe(paths)
	const next = [...selection, item('c')]
	expect(selectedPathsOf(next)).not.toBe(paths)
	expect(selectedPathsOf(next).has('/Home/c')).toBe(true)
})

test('a selected row knows where it stands in its run from the rows either side of it', () => {
	// Rows a to f, with b, c, d and f selected
	const selected = new Set(['b', 'c', 'd', 'f'])
	const rows = ['a', 'b', 'c', 'd', 'e', 'f']
	const positions = rows.map((row, index) => selectionPositionOf(selected, row, rows[index - 1], rows[index + 1]))
	expect(positions).toEqual(['', 'first', 'middle', 'last', '', 'standalone'])
	// The listing's own first and last rows have nothing on one side
	expect(selectionPositionOf(new Set(['a', 'b']), 'a', undefined, 'b')).toBe('first')
	expect(selectionPositionOf(new Set(['e', 'f']), 'f', 'e', undefined)).toBe('last')
})
