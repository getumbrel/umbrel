import {describe, test, expect} from 'vitest'

import {getRoundedDeviceSize} from './raid.js'

describe('getRoundedDeviceSize', () => {
	// Under 1TB - should return unchanged
	test('returns unchanged for sizes under 1TB', () => {
		expect(getRoundedDeviceSize(0)).toBe(0)
		expect(getRoundedDeviceSize(1)).toBe(1)
		expect(getRoundedDeviceSize(32_000_000_000)).toBe(32_000_000_000) // 32GB
		expect(getRoundedDeviceSize(64_000_000_000)).toBe(64_000_000_000) // 64GB
		expect(getRoundedDeviceSize(128_000_000_000)).toBe(128_000_000_000) // 128GB
		expect(getRoundedDeviceSize(256_000_000_000)).toBe(256_000_000_000) // 256GB
		expect(getRoundedDeviceSize(512_000_000_000)).toBe(512_000_000_000) // 512GB
		expect(getRoundedDeviceSize(999_999_999_999)).toBe(999_999_999_999) // Just under 1TB
	})

	// Exactly 1TB boundary
	test('rounds down exactly 1TB to 1TB', () => {
		expect(getRoundedDeviceSize(1_000_000_000_000)).toBe(1_000_000_000_000)
	})

	// 1TB+ should round to nearest 250GB
	test('rounds 1TB+ down to nearest 250GB', () => {
		// Just over 1TB - rounds to 1TB
		expect(getRoundedDeviceSize(1_000_000_000_001)).toBe(1_000_000_000_000)
		expect(getRoundedDeviceSize(1_100_000_000_000)).toBe(1_000_000_000_000)

		// 1.25TB exactly
		expect(getRoundedDeviceSize(1_250_000_000_000)).toBe(1_250_000_000_000)

		// Between 1.25TB and 1.5TB - rounds to 1.25TB
		expect(getRoundedDeviceSize(1_400_000_000_000)).toBe(1_250_000_000_000)

		// 1.5TB exactly
		expect(getRoundedDeviceSize(1_500_000_000_000)).toBe(1_500_000_000_000)

		// 2TB
		expect(getRoundedDeviceSize(2_000_000_000_000)).toBe(2_000_000_000_000)
		expect(getRoundedDeviceSize(2_100_000_000_000)).toBe(2_000_000_000_000)
	})

	// 3.8TB SSD - rounds down to 3.75TB (15 x 250GB)
	test('rounds 3.8TB SSD size correctly', () => {
		const SSD_3_8TB = 3_800_000_000_000 // 3.8TB

		// Rounds down to 3.75TB (15 x 250GB)
		expect(getRoundedDeviceSize(SSD_3_8TB)).toBe(3_750_000_000_000)
	})

	// Real-world 4TB SSD sizes
	test('rounds real 4TB SSD sizes correctly', () => {
		const PHISON_4TB = 4_096_805_658_624 // Larger Phison SSD
		const SAMSUNG_4TB = 4_000_787_030_016 // Smaller Samsung SSD
		const EXACT_4TB = 4_000_000_000_000 // Exactly 4TB

		// All should round down to 4TB (16 x 250GB)
		expect(getRoundedDeviceSize(PHISON_4TB)).toBe(4_000_000_000_000)
		expect(getRoundedDeviceSize(SAMSUNG_4TB)).toBe(4_000_000_000_000)
		expect(getRoundedDeviceSize(EXACT_4TB)).toBe(4_000_000_000_000)
	})

	// Hypothetical 2TB SSD sizes
	test('rounds 2TB SSD sizes correctly', () => {
		const LARGER_2TB = 2_048_000_000_000 // 2.048TB - rounds down to 2TB
		const SMALLER_2TB = 2_000_500_000_000 // Just over 2TB - rounds down to 2TB
		const EXACT_2TB = 2_000_000_000_000

		// All should round down to 2TB (8 x 250GB)
		expect(getRoundedDeviceSize(LARGER_2TB)).toBe(2_000_000_000_000)
		expect(getRoundedDeviceSize(SMALLER_2TB)).toBe(2_000_000_000_000)
		expect(getRoundedDeviceSize(EXACT_2TB)).toBe(2_000_000_000_000)
	})

	// Hypothetical 8TB SSD sizes
	test('rounds 8TB SSD sizes correctly', () => {
		const LARGER_8TB = 8_100_000_000_000 // 8.1TB - rounds down to 8TB
		const EXACT_8TB = 8_000_000_000_000

		// All should round down to 8TB (32 x 250GB)
		expect(getRoundedDeviceSize(LARGER_8TB)).toBe(8_000_000_000_000)
		expect(getRoundedDeviceSize(EXACT_8TB)).toBe(8_000_000_000_000)
	})

	// Edge cases around 250GB boundaries
	test('handles 250GB boundaries correctly', () => {
		// Just under 1.25TB - rounds to 1TB
		expect(getRoundedDeviceSize(1_249_999_999_999)).toBe(1_000_000_000_000)

		// Exactly 1.25TB
		expect(getRoundedDeviceSize(1_250_000_000_000)).toBe(1_250_000_000_000)

		// Just over 1.25TB - still rounds to 1.25TB
		expect(getRoundedDeviceSize(1_250_000_000_001)).toBe(1_250_000_000_000)
	})
})
