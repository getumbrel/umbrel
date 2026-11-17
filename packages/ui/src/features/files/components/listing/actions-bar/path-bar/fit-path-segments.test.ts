import {describe, expect, test} from 'vitest'

import {fitPathSegments} from './fit-path-segments'

const fit = (available: number, widths: number[]) =>
	fitPathSegments({available, widths, minWidth: 42, overflowWidth: 36})

describe('fitPathSegments', () => {
	test('leaves a path that fits as it is', () => {
		expect(fit(500, [60, 100, 100, 80])).toEqual({
			foldsRoot: false,
			folded: 0,
			widths: [undefined, undefined, undefined, undefined],
		})
	})

	test('narrows the current folder beside the root, then folds the root when even that is too narrow', () => {
		expect(fit(200, [60, 300])).toEqual({foldsRoot: false, folded: 0, widths: [undefined, 140]})
		expect(fit(100, [60, 300])).toEqual({foldsRoot: true, folded: 0, widths: [undefined, 64]})
	})

	test('narrows the folders between the root and the parent to an equal share', () => {
		const {folded, widths} = fit(400, [60, 100, 100, 100, 80, 70])
		expect(folded).toBe(0)
		expect(widths[0]).toBeUndefined()
		expect(widths.slice(1, 4)).toEqual([190 / 3, 190 / 3, 190 / 3])
		expect(widths.slice(4)).toEqual([undefined, undefined])
	})

	test('keeps a folder narrower than its share whole and gives the rest its room', () => {
		expect(fit(400, [60, 30, 120, 120, 80, 70]).widths).toEqual([undefined, undefined, 80, 80, undefined, undefined])
	})

	test('folds folders from the root end once the rest are at their narrowest', () => {
		// 210px for the root, parent and current folder, 36px for the menu: three 42px folders fit in what's left
		const {folded, widths} = fit(400, [60, 100, 100, 100, 100, 100, 100, 100, 80, 70])
		expect(folded).toBe(4)
		expect(widths.slice(5, 8)).toEqual([154 / 3, 154 / 3, 154 / 3])
		expect(widths.slice(8)).toEqual([undefined, undefined])
	})

	test('folds the parent last, keeping the root and the current folder', () => {
		expect(fit(400, [60, 100, 200, 300])).toEqual({
			foldsRoot: false,
			folded: 2,
			widths: [undefined, undefined, undefined, undefined],
		})
	})

	test('narrows a long current folder once everything else is folded, keeping the root', () => {
		expect(fit(300, [60, 100, 400])).toEqual({foldsRoot: false, folded: 1, widths: [undefined, undefined, 204]})
	})

	test('folds a lone parent when the root and the current folder only fit without it', () => {
		expect(fit(300, [60, 200, 180])).toEqual({foldsRoot: false, folded: 1, widths: [undefined, undefined, undefined]})
	})

	test('leaves the menu and the current folder in a bar too narrow for the root beside them', () => {
		expect(fit(100, [60, 100, 400])).toEqual({foldsRoot: true, folded: 1, widths: [undefined, undefined, 64]})
		expect(fit(60, [60, 100, 400])).toEqual({foldsRoot: true, folded: 1, widths: [undefined, undefined, 42]})
	})

	// Home/Documents/Projects/2026/Q4 Planning/Reviews/Drafts/Final Versions/Level 7, as measured in Files
	const deepPath = [75, 80, 70, 71, 107, 87, 75, 115, 69]

	test('keeps Home, the nearest folders and the current folder on a deep path at 1440px', () => {
		expect(fitPathSegments({available: 473, widths: deepPath, minWidth: 42, overflowWidth: 35})).toMatchObject({
			foldsRoot: false,
			folded: 2,
		})
	})

	test('shows the menu and the current folder on a deep path in the 97px bar at 1024px', () => {
		expect(fitPathSegments({available: 97, widths: deepPath, minWidth: 42, overflowWidth: 35})).toEqual({
			foldsRoot: true,
			folded: 7,
			widths: [...Array(8).fill(undefined), 62],
		})
	})

	test('folds instead of narrowing when the folders between may not narrow', () => {
		const foldFirst = (available: number, widths: number[]) =>
			fitPathSegments({available, widths, minWidth: Infinity, minCurrentWidth: 64, overflowWidth: 36})
		// 60 + 36 + 80 + 70 fit in 300, with one more folder beside them not
		expect(foldFirst(300, [60, 100, 100, 100, 80, 70])).toEqual({
			foldsRoot: false,
			folded: 3,
			widths: [undefined, undefined, undefined, undefined, undefined, undefined],
		})
		// Everything between folded: the current folder narrows beside the root, down to its own floor
		expect(foldFirst(200, [60, 100, 400])).toEqual({foldsRoot: false, folded: 1, widths: [undefined, undefined, 104]})
		expect(foldFirst(150, [60, 100, 400])).toEqual({foldsRoot: true, folded: 1, widths: [undefined, undefined, 114]})
	})

	test('stands the root as its icon before the parent folds or the current folder narrows', () => {
		const withIcon = (available: number, widths: number[]) =>
			fitPathSegments({
				available,
				widths,
				minWidth: Infinity,
				minCurrentWidth: 64,
				overflowWidth: 36,
				rootCompactWidth: 40,
			})
		// Home and Documents don't both fit whole: Home is its icon, and Documents keeps its name
		expect(withIcon(150, [80, 100])).toEqual({foldsRoot: false, folded: 0, widths: [40, undefined]})
		// The folders nearest the root fold first, with the root's name still beside the menu
		expect(withIcon(300, [80, 100, 100, 80, 70])).toEqual({
			foldsRoot: false,
			folded: 2,
			widths: [undefined, undefined, undefined, undefined, undefined],
		})
		// Then the root's name goes, and the parent stays
		expect(withIcon(240, [80, 100, 100, 80, 70])).toEqual({
			foldsRoot: false,
			folded: 2,
			widths: [40, undefined, undefined, undefined, undefined],
		})
		// A parent too long to stay folds, and the root has its name back beside the menu
		expect(withIcon(200, [80, 100, 70])).toEqual({
			foldsRoot: false,
			folded: 1,
			widths: [undefined, undefined, undefined],
		})
		// The current folder narrows beside the icon, and only then does the root fold away
		expect(withIcon(160, [80, 100, 400])).toEqual({foldsRoot: false, folded: 1, widths: [40, undefined, 84]})
		expect(withIcon(120, [80, 100, 400])).toEqual({foldsRoot: true, folded: 1, widths: [undefined, undefined, 84]})
	})
})
