import {expect, test} from 'vitest'

import {memoryRoom} from './memory-room.ts'

const kernel = (files: Record<string, string>) => (path: string) => files[path] ?? ''

test('counts what was read back from swap by the size of the pages it is counted in', () => {
	const files = {
		'/proc/meminfo': 'MemAvailable:    1024 kB\nSwapFree:        2048 kB\n',
		'/proc/vmstat': 'pswpin 6400\n',
	}
	// The same count is four times as much on a Raspberry Pi 5, whose pages are 16 KiB
	expect(memoryRoom(kernel(files), 4096)?.swappedInMb).toBe(25)
	expect(memoryRoom(kernel(files), 16384)?.swappedInMb).toBe(100)
})
