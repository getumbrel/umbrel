import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'

// How much memory the device has to spare, and whether it is short of it now.
//
// What is free: what the kernel calls available, and what the models that
// read the library hold already, which is theirs to give up (they all run in
// umbrelbackground.slice, see packages/os). That is what there would be with
// none of them loaded, without anything else on the device giving any up.
//
// What can be found on top of that, two ways. ZFS gives back what it keeps of
// files it has read (its ARC, which the kernel does not count as available):
// on a device that has been up a while that is most of what is not in use.
// And the kernel moves what apps hold and have not touched in hours to swap,
// compressed. Both are as good as free on a device at rest, and neither is on
// one that is short of memory for what it is doing: there the cache is in
// use, and what is moved to swap is wanted back.
//
// Which a device is shows in how much it reads back from swap. One at rest
// reads next to nothing back, however much it has there. One whose apps are
// taking turns at memory reads back all the time. And a model loaded on the
// strength of what can be found has pushed out something in use if the device
// starts to.
//
// What is left of swap says whether more can be moved there at all. What the
// models hold counts as swap left too: it is in swap already, or has put that
// much there.
//
// Pressure is the share of the last minute in which something on the device
// was held up waiting for memory, which is what being short of memory is:
// next to nothing on a healthy device, and tens of percent on one that is
// swapping to keep going. Over a minute and not the last ten seconds, which
// the kernel also gives: a moment's worth says little, and is reached while a
// model is only loading.
//
// Undefined where the kernel does not say (in development, off Linux).
export function memoryRoom(read = readOrNothing, pageBytes = pageSize()) {
	const megabytes = (text: string, pattern: RegExp, unit: number) => Number(pattern.exec(text)?.[1] ?? 0) / unit
	const memory = read('/proc/meminfo')
	if (!memory) return undefined
	const available = megabytes(memory, /^MemAvailable:\s+(\d+)/m, 1024)
	const cache = read('/proc/spl/kstat/zfs/arcstats')
	const kept = megabytes(cache, /^size\s+\d+\s+(\d+)/m, 1024 ** 2)
	const least = megabytes(cache, /^c_min\s+\d+\s+(\d+)/m, 1024 ** 2)
	// What a model holds on a GPU that shares the device's memory is counted
	// to it as shared memory
	const models = read('/sys/fs/cgroup/umbrelbackground.slice/memory.stat')
	const held = megabytes(models, /^anon (\d+)/m, 1024 ** 2) + megabytes(models, /^shmem (\d+)/m, 1024 ** 2)
	const swapped = megabytes(read('/sys/fs/cgroup/umbrelbackground.slice/memory.swap.current'), /^(\d+)/, 1024 ** 2)
	return {
		freeMb: Math.round(available + held),
		cacheMb: Math.round(Math.max(0, kept - least)),
		swapRoomMb: Math.round(megabytes(memory, /^SwapFree:\s+(\d+)/m, 1024) + held + swapped),
		// Counted in pages since the device started
		swappedInMb: megabytes(read('/proc/vmstat'), /^pswpin (\d+)/m, 1024 ** 2 / pageBytes),
		pressure: Number(/^some .*avg60=([\d.]+)/m.exec(read('/proc/pressure/memory'))?.[1] ?? 0),
		// The same over the last ten seconds, for when a moment's worth is what
		// is wanted: just after more models were loaded than fit in what is free
		pressureNow: Number(/^some avg10=([\d.]+)/m.exec(read('/proc/pressure/memory'))?.[1] ?? 0),
	}
}

function readOrNothing(path: string) {
	try {
		return readFileSync(path, 'utf8')
	} catch {
		return ''
	}
}

// How large the kernel's pages are, which is not the same everywhere: 4 KiB
// on most devices and 16 KiB on a Raspberry Pi 5
let kernelPageBytes: number | undefined
function pageSize() {
	if (kernelPageBytes === undefined) {
		try {
			kernelPageBytes = Number(execFileSync('getconf', ['PAGESIZE'], {encoding: 'utf8'})) || 4096
		} catch {
			kernelPageBytes = 4096
		}
	}
	return kernelPageBytes
}
