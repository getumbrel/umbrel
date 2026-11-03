import {describe, expect, test} from 'vitest'

import {defaultVolumeLabel} from './default-label'

describe('defaultVolumeLabel', () => {
	test('keeps whole words within the 11-character limit', () => {
		expect(defaultVolumeLabel('Generic Flash Disk')).toBe('Generic')
		expect(defaultVolumeLabel('SanDisk Extreme Pro Portable SSD V2')).toBe('SanDisk')
		expect(defaultVolumeLabel('Samsung T7 Shield')).toBe('Samsung T7')
		expect(defaultVolumeLabel('Kingston')).toBe('Kingston')
	})

	test('leaves out words a volume label cannot hold', () => {
		expect(defaultVolumeLabel('USB DISK 3.0')).toBe('USB DISK')
		expect(defaultVolumeLabel('Lexar (SL660)')).toBe('Lexar')
	})

	test('cuts a single long word and falls back when nothing is usable', () => {
		expect(defaultVolumeLabel('ST1000LM035-1RK172')).toBe('ST1000LM035')
		expect(defaultVolumeLabel('')).toBe('Untitled')
		expect(defaultVolumeLabel('USB 3.0')).toBe('USB')
		expect(defaultVolumeLabel('(2.0)')).toBe('Untitled')
	})
})
