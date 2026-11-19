// The sandbox decides what a command can see. This decides what it can ask the
// kernel to do: a seccomp filter, loaded by bubblewrap before the command
// starts, that refuses the system calls below. Everything else is allowed, so
// a new version of a tool or of the C library needs nothing added here.
//
// A refused call fails with "operation not permitted", as it would for a
// program without the privilege for it, and the command carries on.

// System calls no sandboxed command has a use for, each a way to act on the
// kernel or the host rather than on the command's own files. Most already
// need a privilege no sandboxed command has; refusing the call as well means
// a kernel bug in one of them can't be reached.
const REFUSED = [
	// Changing what is mounted where
	...['mount', 'umount2', 'pivot_root', 'chroot', 'open_tree', 'move_mount'],
	...['fsopen', 'fsconfig', 'fsmount', 'fspick', 'mount_setattr'],
	// Entering or creating a namespace, which is how the sandbox itself was
	// made. `clone` is refused when asked for one: see below.
	...['unshare', 'setns'],
	// Reading or controlling another process
	...['ptrace', 'process_vm_readv', 'process_vm_writev', 'kcmp'],
	// Loading code into the kernel, or replacing it
	...['init_module', 'finit_module', 'delete_module', 'kexec_load', 'kexec_file_load', 'bpf'],
	// Administering the system
	...['reboot', 'swapon', 'swapoff', 'acct', 'syslog', 'quotactl', 'quotactl_fd', 'vhangup', 'nfsservctl'],
	...['settimeofday', 'clock_settime', 'clock_adjtime', 'adjtimex', 'sethostname', 'setdomainname'],
	// Raw access to hardware ports
	...['iopl', 'ioperm'],
	// Opening a file by a handle instead of a path, which reaches files the
	// sandbox was never shown
	'open_by_handle_at',
	// Kernel features with a long record of security bugs that a tool reading
	// or writing files does not use
	...['perf_event_open', 'userfaultfd', 'io_uring_setup', 'io_uring_enter', 'io_uring_register'],
	...['add_key', 'request_key', 'keyctl', 'lookup_dcookie', 'uselib', 'personality'],
	// Placing memory on particular processors' nodes
	...['mbind', 'set_mempolicy', 'get_mempolicy', 'migrate_pages', 'move_pages', 'set_mempolicy_home_node'],
] as const

// The kinds of namespace `clone` can create
const NAMESPACE_FLAGS =
	0x0002_0000 | // mount
	0x0200_0000 | // cgroup
	0x0400_0000 | // hostname
	0x0800_0000 | // inter-process communication
	0x1000_0000 | // user
	0x2000_0000 | // process
	0x4000_0000 | // network
	0x0000_0080 // time

// The kinds of socket a command can create. One with no network gets sockets
// between its own processes and nothing else. One with the network gets
// internet sockets too, and the kind the C library asks the kernel which
// addresses the device has with. No command gets any other kind: raw packets,
// Bluetooth, the kernel's crypto interface and the rest.
const SOCKETS = {
	local: 1,
	internet: 2,
	internetVersion6: 10,
	kernelAddressInformation: 16,
}

// Commands that put input into, or read the screen of, the terminal they run in
const REFUSED_TERMINAL_COMMANDS = [0x5412, 0x541c]

// Where each system call is in the kernel's table on x86-64 and on arm64. A
// call missing on one does not exist there.
const NUMBERS: Record<string, {x64?: number; arm64?: number}> = {
	mount: {x64: 165, arm64: 40},
	umount2: {x64: 166, arm64: 39},
	pivot_root: {x64: 155, arm64: 41},
	chroot: {x64: 161, arm64: 51},
	open_tree: {x64: 428, arm64: 428},
	move_mount: {x64: 429, arm64: 429},
	fsopen: {x64: 430, arm64: 430},
	fsconfig: {x64: 431, arm64: 431},
	fsmount: {x64: 432, arm64: 432},
	fspick: {x64: 433, arm64: 433},
	mount_setattr: {x64: 442, arm64: 442},
	unshare: {x64: 272, arm64: 97},
	setns: {x64: 308, arm64: 268},
	clone: {x64: 56, arm64: 220},
	clone3: {x64: 435, arm64: 435},
	ptrace: {x64: 101, arm64: 117},
	process_vm_readv: {x64: 310, arm64: 270},
	process_vm_writev: {x64: 311, arm64: 271},
	kcmp: {x64: 312, arm64: 272},
	init_module: {x64: 175, arm64: 105},
	finit_module: {x64: 313, arm64: 273},
	delete_module: {x64: 176, arm64: 106},
	kexec_load: {x64: 246, arm64: 104},
	kexec_file_load: {x64: 320, arm64: 294},
	bpf: {x64: 321, arm64: 280},
	reboot: {x64: 169, arm64: 142},
	swapon: {x64: 167, arm64: 224},
	swapoff: {x64: 168, arm64: 225},
	acct: {x64: 163, arm64: 89},
	syslog: {x64: 103, arm64: 116},
	quotactl: {x64: 179, arm64: 60},
	quotactl_fd: {x64: 443, arm64: 443},
	vhangup: {x64: 153, arm64: 58},
	nfsservctl: {x64: 180, arm64: 42},
	settimeofday: {x64: 164, arm64: 170},
	clock_settime: {x64: 227, arm64: 112},
	clock_adjtime: {x64: 305, arm64: 266},
	adjtimex: {x64: 159, arm64: 171},
	sethostname: {x64: 170, arm64: 161},
	setdomainname: {x64: 171, arm64: 162},
	iopl: {x64: 172},
	ioperm: {x64: 173},
	open_by_handle_at: {x64: 304, arm64: 265},
	perf_event_open: {x64: 298, arm64: 241},
	userfaultfd: {x64: 323, arm64: 282},
	io_uring_setup: {x64: 425, arm64: 425},
	io_uring_enter: {x64: 426, arm64: 426},
	io_uring_register: {x64: 427, arm64: 427},
	add_key: {x64: 248, arm64: 217},
	request_key: {x64: 249, arm64: 218},
	keyctl: {x64: 250, arm64: 219},
	lookup_dcookie: {x64: 212, arm64: 18},
	uselib: {x64: 134},
	personality: {x64: 135, arm64: 92},
	mbind: {x64: 237, arm64: 235},
	set_mempolicy: {x64: 238, arm64: 237},
	get_mempolicy: {x64: 239, arm64: 236},
	migrate_pages: {x64: 256, arm64: 238},
	move_pages: {x64: 279, arm64: 239},
	set_mempolicy_home_node: {x64: 450, arm64: 450},
	socket: {x64: 41, arm64: 198},
	socketpair: {x64: 53, arm64: 199},
	ioctl: {x64: 16, arm64: 29},
}

// How the kernel names each architecture to a filter
const ARCHITECTURES = {x64: 0xc000_003e, arm64: 0xc000_00b7}
export type Architecture = keyof typeof ARCHITECTURES

// What a filter answers with
const ALLOW = 0x7fff_0000
const KILL = 0x8000_0000
const refuse = (error: number) => 0x0005_0000 | error
const NOT_PERMITTED = refuse(1)
const NO_SUCH_SYSTEM_CALL = refuse(38)
const NO_SUCH_KIND_OF_SOCKET = refuse(97)

// A filter is a short program in the kernel's packet filter language. It is
// handed the system call's number, architecture and arguments, and runs top
// to bottom, jumping forward only.
type Instruction = [code: number, ifTrue: number, ifFalse: number, value: number]
const load = (offset: number): Instruction => [0x20, 0, 0, offset]
const ifEqual = (value: number, ifTrue: number, ifFalse: number): Instruction => [0x15, ifTrue, ifFalse, value]
const ifAtLeast = (value: number, ifTrue: number, ifFalse: number): Instruction => [0x35, ifTrue, ifFalse, value]
const ifAnyBitSet = (value: number, ifTrue: number, ifFalse: number): Instruction => [0x45, ifTrue, ifFalse, value]
const answer = (value: number): Instruction => [0x06, 0, 0, value]
// Where the filter finds things in what it is handed. Arguments are 64-bit
// and every value checked here fits the low half.
const NUMBER = 0
const ARCHITECTURE = 4
const argument = (index: number) => 16 + 8 * index

// The filter for a command that is, or isn't, allowed the network, as the
// bytes bubblewrap loads
export function systemCallFilter({network, architecture}: {network: boolean; architecture: Architecture}) {
	const number = (name: string) => NUMBERS[name]?.[architecture]
	// Runs `instructions` when the call is `name`. They must end in an answer.
	const when = (name: string, instructions: Instruction[]): Instruction[] => {
		const systemCall = number(name)
		if (systemCall === undefined) return []
		return [ifEqual(systemCall, 0, instructions.length), ...instructions]
	}
	const sockets = network ? Object.values(SOCKETS) : [SOCKETS.local]
	const onlyAllowedSockets: Instruction[] = [
		load(argument(0)),
		// Each allowed kind jumps to the last line; any other falls to the one before
		...sockets.map((kind, index) => ifEqual(kind, sockets.length - index, 0)),
		answer(NO_SUCH_KIND_OF_SOCKET),
		answer(ALLOW),
	]

	const program: Instruction[] = [
		// A program built for another architecture numbers its system calls
		// differently, and would be checked against the wrong table. umbrelOS
		// has no such programs, so one that tries is stopped.
		load(ARCHITECTURE),
		ifEqual(ARCHITECTURES[architecture], 1, 0),
		answer(KILL),
		load(NUMBER),
		// x86-64 has a second numbering for 32-bit pointers, starting here
		...(architecture === 'x64' ? [ifAtLeast(0x4000_0000, 0, 1), answer(NO_SUCH_SYSTEM_CALL)] : []),

		...REFUSED.flatMap((name) => when(name, [answer(NOT_PERMITTED)])),

		// `clone` starts threads and processes, and can also give them new
		// namespaces. Only that is refused.
		...when('clone', [load(argument(0)), ifAnyBitSet(NAMESPACE_FLAGS, 0, 1), answer(NOT_PERMITTED), answer(ALLOW)]),
		// `clone3` takes its flags where a filter can't read them. Told it
		// doesn't exist, the C library falls back to `clone`.
		...when('clone3', [answer(NO_SUCH_SYSTEM_CALL)]),

		...when('socket', onlyAllowedSockets),
		...when('socketpair', onlyAllowedSockets),

		...when('ioctl', [
			load(argument(1)),
			...REFUSED_TERMINAL_COMMANDS.map((command, index) =>
				ifEqual(command, REFUSED_TERMINAL_COMMANDS.length - index, 0),
			),
			answer(ALLOW),
			answer(NOT_PERMITTED),
		]),

		answer(ALLOW),
	]

	const bytes = Buffer.alloc(program.length * 8)
	for (const [index, [code, ifTrue, ifFalse, value]] of program.entries()) {
		bytes.writeUInt16LE(code, index * 8)
		bytes.writeUInt8(ifTrue, index * 8 + 2)
		bytes.writeUInt8(ifFalse, index * 8 + 3)
		bytes.writeUInt32LE(value >>> 0, index * 8 + 4)
	}
	return bytes
}
