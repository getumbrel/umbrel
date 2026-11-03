import {describe, expect, test} from 'vitest'

import {machineIdCandidate, machineIdSchema, slugifyMachineId} from './machine-id.ts'

describe('machine ids', () => {
	test('creates safe, bounded slugs with a stable empty-name fallback', () => {
		expect(slugifyMachineId(' Ubuntu Desktop  ')).toBe('ubuntu-desktop')
		expect(slugifyMachineId('你好 🖥️')).toBe('machine')
		expect(slugifyMachineId(`${'a'.repeat(80)}---`)).toBe('a'.repeat(63))
	})

	test('deduplicates without confusing a legitimate numeric name suffix', () => {
		expect(machineIdCandidate(slugifyMachineId('Ubuntu Desktop 2'), 1)).toBe('ubuntu-desktop-2')
		expect(machineIdCandidate(slugifyMachineId('Ubuntu Desktop'), 2)).toBe('ubuntu-desktop-2')
		expect(machineIdCandidate('a'.repeat(63), 12)).toBe(`${'a'.repeat(60)}-12`)
	})

	test('rejects traversal, dots, uppercase, and malformed separators', () => {
		for (const id of ['../machine', 'machine/name', '.machine', 'machine.', '-machine', 'machine-', 'Machine', '']) {
			expect(() => machineIdSchema.parse(id)).toThrow()
		}
	})
})
