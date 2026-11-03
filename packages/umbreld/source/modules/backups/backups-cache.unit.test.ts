import {describe, expect, test} from 'vitest'

import {kopiaCacheSizeFlagsForInodes} from './backups.ts'

describe('kopiaCacheSizeFlagsForInodes()', () => {
	test.each([1, 1_261_568, 5_000_000])('limits caches on a filesystem with %i total inodes', (totalInodes) => {
		expect(kopiaCacheSizeFlagsForInodes(totalInodes)).toEqual([
			'--content-cache-size-mb=500',
			'--content-cache-size-limit-mb=1000',
			'--metadata-cache-size-mb=1000',
			'--metadata-cache-size-limit-mb=2000',
		])
	})

	test.each([0, 5_000_001, 19_079_777_196])(
		'preserves kopia defaults on a filesystem with %i total inodes',
		(totalInodes) => {
			expect(kopiaCacheSizeFlagsForInodes(totalInodes)).toEqual([])
		},
	)
})
