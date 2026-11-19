import {describe, expect, test} from 'vitest'

import {systemCallFilter, type Architecture} from './sandbox-system-calls.ts'

// Runs a compiled filter the way the kernel does, on one system call, and
// returns its answer
function run(filter: Buffer, call: {architecture: number; number: number; arguments?: number[]}) {
	const data = Buffer.alloc(64)
	data.writeUInt32LE(call.number, 0)
	data.writeUInt32LE(call.architecture, 4)
	for (const [index, value] of (call.arguments ?? []).entries()) data.writeUInt32LE(value, 16 + 8 * index)

	let accumulator = 0
	for (let line = 0; line < filter.length / 8; line++) {
		const code = filter.readUInt16LE(line * 8)
		const ifTrue = filter.readUInt8(line * 8 + 2)
		const ifFalse = filter.readUInt8(line * 8 + 3)
		const value = filter.readUInt32LE(line * 8 + 4)
		if (code === 0x20) accumulator = data.readUInt32LE(value)
		else if (code === 0x15) line += accumulator === value ? ifTrue : ifFalse
		else if (code === 0x35) line += accumulator >= value ? ifTrue : ifFalse
		else if (code === 0x45) line += (accumulator & value) >>> 0 === 0 ? ifFalse : ifTrue
		else if (code === 0x06) return value
		else throw new Error(`Unknown instruction ${code}`)
	}
	throw new Error('The filter ended without an answer')
}

const ALLOWED = 0x7fff_0000
const KILLED = 0x8000_0000
const NOT_PERMITTED = 0x0005_0001
const NO_SUCH_SYSTEM_CALL = 0x0005_0026
const NO_SUCH_KIND_OF_SOCKET = 0x0005_0061

// The same calls on each architecture, by their numbers there
const architectures = {
	x64: {id: 0xc000_003e, read: 0, execve: 59, mount: 165, unshare: 272, ptrace: 101, bpf: 321, clone: 56, clone3: 435},
	arm64: {
		id: 0xc000_00b7,
		read: 63,
		execve: 221,
		mount: 40,
		unshare: 97,
		ptrace: 117,
		bpf: 280,
		clone: 220,
		clone3: 435,
	},
}
const sockets = {x64: {socket: 41, socketpair: 53, ioctl: 16}, arm64: {socket: 198, socketpair: 199, ioctl: 29}}

describe.each(['x64', 'arm64'] as Architecture[])('the system call filter on %s', (architecture) => {
	const calls = architectures[architecture]
	const call = (number: number, ...arguments_: number[]) => ({architecture: calls.id, number, arguments: arguments_})
	const filter = systemCallFilter({network: false, architecture})
	const networked = systemCallFilter({network: true, architecture})

	test('allows the calls programs are made of', () => {
		expect(run(filter, call(calls.read))).toBe(ALLOWED)
		expect(run(filter, call(calls.execve))).toBe(ALLOWED)
		// A system call the kernel gains tomorrow
		expect(run(filter, call(999))).toBe(ALLOWED)
	})

	test('refuses the calls that act on the kernel or the host', () => {
		for (const number of [calls.mount, calls.unshare, calls.ptrace, calls.bpf]) {
			expect(run(filter, call(number))).toBe(NOT_PERMITTED)
			expect(run(networked, call(number))).toBe(NOT_PERMITTED)
		}
	})

	test('lets clone start threads and processes but not namespaces', () => {
		const thread = 0x003d_0f00
		const childProcess = 0x0120_0011
		expect(run(filter, call(calls.clone, thread))).toBe(ALLOWED)
		expect(run(filter, call(calls.clone, childProcess))).toBe(ALLOWED)
		for (const namespace of [0x0002_0000, 0x1000_0000, 0x2000_0000, 0x4000_0000, 0x0000_0080]) {
			expect(run(filter, call(calls.clone, childProcess | namespace))).toBe(NOT_PERMITTED)
		}
		// The C library tries clone3 first and must be told to use clone
		expect(run(filter, call(calls.clone3))).toBe(NO_SUCH_SYSTEM_CALL)
	})

	test('allows only local sockets without the network', () => {
		for (const number of [sockets[architecture].socket, sockets[architecture].socketpair]) {
			expect(run(filter, call(number, 1))).toBe(ALLOWED)
			for (const kind of [2, 10, 16, 17, 38]) expect(run(filter, call(number, kind))).toBe(NO_SUCH_KIND_OF_SOCKET)
		}
	})

	test('allows internet sockets with the network, and still no raw packets', () => {
		for (const number of [sockets[architecture].socket, sockets[architecture].socketpair]) {
			for (const kind of [1, 2, 10, 16]) expect(run(networked, call(number, kind))).toBe(ALLOWED)
			// Raw packets, the kernel's crypto interface, Bluetooth
			for (const kind of [17, 38, 31]) expect(run(networked, call(number, kind))).toBe(NO_SUCH_KIND_OF_SOCKET)
		}
	})

	test('refuses typing into the terminal and nothing else a terminal or device is asked', () => {
		const ioctl = sockets[architecture].ioctl
		expect(run(filter, call(ioctl, 0, 0x5412))).toBe(NOT_PERMITTED)
		expect(run(filter, call(ioctl, 0, 0x541c))).toBe(NOT_PERMITTED)
		// Asking a terminal its size, and a GPU driver's own commands
		expect(run(filter, call(ioctl, 0, 0x5413))).toBe(ALLOWED)
		expect(run(filter, call(ioctl, 0, 0xc010_6400))).toBe(ALLOWED)
	})

	test('stops a program that uses another architecture’s system calls', () => {
		const other = architecture === 'x64' ? architectures.arm64.id : architectures.x64.id
		expect(run(filter, {architecture: other, number: calls.read})).toBe(KILLED)
		// 32-bit programs on each
		expect(run(filter, {architecture: 0x4000_0003, number: 3})).toBe(KILLED)
		expect(run(filter, {architecture: 0x4000_0028, number: 3})).toBe(KILLED)
	})
})

test('refuses x86-64’s second numbering of the same calls', () => {
	const filter = systemCallFilter({network: false, architecture: 'x64'})
	// mount, as a program built for 32-bit pointers calls it
	expect(run(filter, {architecture: 0xc000_003e, number: 0x4000_0000 + 165})).toBe(NO_SUCH_SYSTEM_CALL)
})

test('leaves out the calls an architecture does not have', () => {
	// arm64 has no port access calls; x86-64's numbers for them are other calls there
	const filter = systemCallFilter({network: false, architecture: 'arm64'})
	expect(run(filter, {architecture: 0xc000_00b7, number: 172})).toBe(ALLOWED)
	expect(run(filter, {architecture: 0xc000_00b7, number: 173})).toBe(ALLOWED)
})
