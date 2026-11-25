// umbreld's own container runtime, built on bubblewrap.
//
// umbreld runs other programs on input it can't trust: decoders on uploaded
// photos and videos, unar on archives, etc. A crafted input that takes one
// of them over should gain nothing, so each runs in a container made for
// that one command.
//
// There is no image to build or pull, and no copy of the OS. The runtime
// mounts the host's own programs and libraries into the container,
// read-only, and nothing else of the host. So every program on the OS runs
// here as it is, and starts with nothing to reach: no user files, no app
// data, none of umbreld's state or environment, no network and no process
// but its own.
//
// Each call states what its command is allowed on top of that, and that is
// all it gets: paths to read, paths to write, a file umbreld holds open, the
// network, the GPU, a limit on memory and CPU.
//
// Underneath:
// - Namespaces. The command has its own mounts, processes, IPC and hostname,
//   and its own empty network unless it is allowed the real one.
// - No privileges. By default the command is nobody in a user namespace,
//   with no capabilities and no way to gain any. One that has to be root
//   keeps only the four capabilities over files and gets no /proc.
// - A system call filter on every command, root included, which refuses the
//   calls used to break out: mounting, creating namespaces, reading other
//   processes, loading kernel code. See sandbox-system-calls.ts.
// - A cgroup per command, so one that runs away with memory or processes is
//   killed as a whole.
// - No daemon. bubblewrap sets the container up, starts the command and
//   waits; when umbreld dies, so does everything in it.

import {mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs'
import {rmdir, writeFile} from 'node:fs/promises'
import {constants} from 'node:os'
import {setTimeout as sleep} from 'node:timers/promises'
import {threadId} from 'node:worker_threads'

import {execa, type ExecaChildProcess, type KillOptions, type Options} from 'execa'

import {systemCallFilter, type Architecture} from './sandbox-system-calls.ts'

export const GiB = 1024 ** 3

// What a sandboxed command is allowed. Every call states all of it, so the
// whole policy for a command can be read, and reviewed, where it is run.
export type Sandbox = {
	// Whether the command can reach the network. Without it, it can't so
	// much as create a network socket.
	network: boolean
	// Whether the command can use the GPU
	gpu: boolean
	// The files and directories the command can read, and the ones it can also
	// write to. It sees nothing else belonging to users, apps or umbreld.
	readablePaths: string[]
	writablePaths: string[]
	// A file umbreld holds open, for a root command that has to open its input
	// by path. Handed over through `options.stdio` as this descriptor, it is
	// there to read at this path, and the command no longer has the
	// descriptor. What it opens is the file umbreld opened and never another
	// put in its place. Where that file was deleted or replaced before the
	// command starts, the command fails to start.
	readableFile?: {descriptor: number; path: string}
	// The most memory, in bytes, the command and everything it starts may hold
	// between them, the files in its /tmp included. Past it they are all
	// killed. Without this there is no limit.
	memoryLimit?: number
	// The most CPU the command and everything it starts may use between them,
	// in cores. Without this there is no limit.
	cpuLimit?: number
	// Who the command runs as. Without this it is nobody, who owns no file.
	// Give the owner of the user's files when the command creates files that
	// must belong to them.
	//
	// 'root' is for a command that has to act on files as root does, such as
	// a copy that keeps who owns each file. It is root over the paths listed
	// here and nothing else, but it is the weakest sandbox: see ROOT below.
	user?: {userId: number; groupId: number} | 'root'
	// Whether a root command can create device files. A copy that keeps
	// everything needs to, because apps leave device files in their data. The
	// command can never open one: every place it can write to refuses that.
	deviceFiles?: boolean
}

// nobody and nogroup
const NOBODY = {userId: 65534, groupId: 65534}

// An unprivileged command gets namespaces of its own for everything: no
// network, no process to see or signal but its own, and a user namespace in
// which it has no capability and cannot create another to gain one in. Its
// /proc shows its own processes only.
const UNPRIVILEGED = ['--unshare-all', '--unshare-user', '--disable-userns', '--proc', '/proc']

// A root command stays the real root user, so that the kernel lets it read,
// write and change the owner of any file it can see. All it can see is what
// its policy lists, and all it keeps of root's powers are the four over files.
//
// It gets no /proc. Root can write kernel settings there that run commands on
// the host, which would undo everything else. It has no user namespace to
// stop it creating namespaces of its own, so that is left to the system call
// filter every command gets.
const ROOT = [
	...['--unshare-ipc', '--unshare-pid', '--unshare-uts', '--unshare-cgroup-try'],
	...['--cap-drop', 'ALL'],
	...['--cap-add', 'CAP_DAC_OVERRIDE'],
	...['--cap-add', 'CAP_CHOWN'],
	...['--cap-add', 'CAP_FOWNER'],
	...['--cap-add', 'CAP_FSETID'],
]

const VIEW = [
	// It never outlives umbreld, and neither does anything it started
	'--die-with-parent',
	// Nothing from umbreld's environment. The locale is set to the one umbreld
	// runs in, which some programs need to read file names beyond ASCII.
	...['--clearenv', '--setenv', 'PATH', '/usr/bin:/usr/sbin', '--setenv', 'LANG', 'C.UTF-8'],
	// All there is to see is the OS's programs and libraries, read-only
	...['--ro-bind', '/usr', '/usr'],
	...['--symlink', 'usr/bin', '/bin'],
	...['--symlink', 'usr/lib', '/lib'],
	...['--symlink', 'usr/lib64', '/lib64'],
	// Which program a name like `convert` stands for, and where the loader
	// finds libraries
	...['--ro-bind', '/etc/alternatives', '/etc/alternatives'],
	...['--ro-bind', '/etc/ld.so.cache', '/etc/ld.so.cache'],
	// ImageMagick's policy. Without it ImageMagick falls back to its built-in
	// defaults, which have none of the restrictions the OS configures.
	...['--ro-bind', '/etc/ImageMagick-7', '/etc/ImageMagick-7'],
	// The few devices every program expects, and an empty /tmp that is gone
	// when it exits
	...['--dev', '/dev', '--tmpfs', '/tmp'],
]

// What it takes to resolve a name and verify a certificate on the network.
// Names are resolved as umbreld resolves them, which for a .local name means
// asking the mDNS responder through its socket.
const NETWORK = [
	...['--ro-bind-try', '/run/avahi-daemon/socket', '/run/avahi-daemon/socket'],
	...['--ro-bind-try', '/etc/resolv.conf', '/etc/resolv.conf'],
	...['--ro-bind-try', '/etc/hosts', '/etc/hosts'],
	...['--ro-bind-try', '/etc/nsswitch.conf', '/etc/nsswitch.conf'],
	...['--ro-bind-try', '/etc/ssl/certs', '/etc/ssl/certs'],
]

// However many processes and threads a command starts, it has no more than
// this many at once
const TASKS_LIMIT = 512

// The render nodes of Intel and AMD GPUs, NVIDIA's device nodes, and what
// drivers read to find their device and their own configuration
const GPU_RENDER_NODE = '/dev/dri/renderD128'
const GPU = [
	...['--dev-bind-try', '/dev/dri', '/dev/dri'],
	...['--dev-bind-try', '/dev/nvidiactl', '/dev/nvidiactl'],
	...['--dev-bind-try', '/dev/nvidia0', '/dev/nvidia0'],
	...['--dev-bind-try', '/dev/nvidia-uvm', '/dev/nvidia-uvm'],
	...['--dev-bind-try', '/dev/nvidia-uvm-tools', '/dev/nvidia-uvm-tools'],
	...['--ro-bind', '/sys', '/sys'],
	...['--ro-bind-try', '/etc/vulkan', '/etc/vulkan'],
	...['--ro-bind-try', '/etc/OpenCL', '/etc/OpenCL'],
]

// Runs a command on input umbreld cannot trust, such as a file a user
// uploaded. Decoders have bugs that a crafted file can turn into code
// execution, and umbreld runs as root, so it must not be the one running them.
//
// The command sees no process but its own, and of the filesystem sees only the
// OS's own programs plus what `sandbox` lists. Unless it is told to be root it
// runs as an unprivileged user with no capabilities. It can ask the kernel to
// work with its own files and processes and little else. Prefer handing it open
// descriptors through `options.stdio` over listing paths: the input on standard
// input, each output on a descriptor from 3 up. It can then read exactly the
// file umbreld opened, whoever owns that file, and needs no path at all. A
// command that can only open its input by path is shown that same open file
// at one: see `readableFile`.
export function sandboxed(
	command: string,
	arguments_: readonly string[],
	sandbox: Sandbox,
	options?: Options,
): ExecaChildProcess
export function sandboxed(
	command: string,
	arguments_: readonly string[],
	sandbox: Sandbox,
	options: Options<null>,
): ExecaChildProcess<Buffer>
export function sandboxed(
	command: string,
	arguments_: readonly string[],
	sandbox: Sandbox,
	options: Options<any> = {},
): ExecaChildProcess<any> {
	const root = sandbox.user === 'root'
	const user = sandbox.user === 'root' ? undefined : (sandbox.user ?? NOBODY)
	if (user?.userId === 0) throw new Error("A sandboxed command only runs as root when its user is 'root'")
	// A GPU driver needs /proc, which a root command must not have
	if (root && sandbox.gpu) throw new Error('A sandboxed command cannot use the GPU as root')
	if (sandbox.deviceFiles && !root) throw new Error('A sandboxed command only creates device files as root')
	// --unshare-all takes the network away unless told to share it. A root
	// command names each namespace it leaves, so it names this one or doesn't.
	const network = sandbox.network ? (root ? [] : ['--share-net']) : root ? ['--unshare-net'] : []
	if (Array.isArray(options.stdio) && options.stdio.length > FILTER_DESCRIPTOR) {
		throw new Error(`A sandboxed command can be handed at most ${FILTER_DESCRIPTOR} descriptors`)
	}
	const bubblewrap = [
		...(root ? ROOT : UNPRIVILEGED),
		...(sandbox.deviceFiles ? ['--cap-add', 'CAP_MKNOD'] : []),
		// What it can ask of the kernel: see sandbox-system-calls.ts
		...['--seccomp', String(FILTER_DESCRIPTOR)],
		...network,
		...VIEW,
		...(sandbox.network ? NETWORK : []),
		...(sandbox.gpu ? GPU : []),
		// A program sees every core of the device whatever its limit, and one
		// that starts a thread per core then spends its share on switching
		// between them. This is where OpenMP programs, which the image decoders
		// are, look for how many threads to start.
		...(sandbox.cpuLimit === undefined
			? []
			: ['--setenv', 'OMP_NUM_THREADS', String(Math.max(1, Math.ceil(sandbox.cpuLimit)))]),
		// Of umbreld's environment it gets the variables it is given by name
		...Object.entries(options.env ?? {}).flatMap(([name, value]) =>
			value === undefined ? [] : ['--setenv', name, value],
		),
		// It starts in the directory it is given, which has to be one it can
		// see. Left to itself bubblewrap starts it in an empty / when it isn't,
		// where what it writes is lost.
		...(options.cwd === undefined ? [] : ['--chdir', String(options.cwd)]),
		// A directory goes in before anything inside it. Each path covers what
		// is already at that place, so put in after, a writable directory would
		// cover a read-only path inside it and leave it writable.
		...[
			...sandbox.readablePaths.map((path) => ['--ro-bind', path, path]),
			...sandbox.writablePaths.map((path) => ['--bind', path, path]),
		]
			.sort(([, first], [, second]) => (first < second ? -1 : first > second ? 1 : 0))
			.flat(),
		...(sandbox.readableFile
			? ['--ro-bind-fd', String(sandbox.readableFile.descriptor), sandbox.readableFile.path]
			: []),
		'--',
		// Told to stop, it stops, as any command does that isn't started this
		// way: see START
		...['env', '--default-signal=TERM'],
		command,
		...arguments_,
	]
	// umbreld is root. A root command stays that; any other gives it up for
	// good before bubblewrap starts.
	const identity = user
		? [
				'setpriv',
				`--reuid=${user.userId}`,
				// An Intel or AMD render node is open to its group alone, so a
				// command that uses the GPU runs in that group
				`--regid=${sandbox.gpu ? (renderGroupId() ?? user.groupId) : user.groupId}`,
				'--clear-groups',
				'--',
			]
		: []
	const filter = systemCallFilterFile(sandbox.network)
	const limits = limitsFor(sandbox)
	const child = execa('sh', ['-c', START, 'sh', filter, limits ?? '', ...identity, 'bwrap', ...bubblewrap], options)
	if (limits) {
		const remove = () => void removeLimits(limits)
		child.then(remove, remove)
	}
	// A signal goes to the command, as it did before commands were sandboxed.
	// What umbreld started is bubblewrap, and the command is killed when that
	// ends, before it can finish what it was doing. SIGKILL does go to
	// bubblewrap, which ends everything in the sandbox. So does any signal
	// sent before the command has started, when there is nothing to finish.
	const kill = child.kill.bind(child) as (signal?: Signal, options?: KillOptions) => boolean
	child.kill = ((signal: Signal = 'SIGTERM', killOptions: KillOptions = {}) => {
		const command = signal === 'SIGKILL' || signal === SIGKILL ? undefined : commandProcess(child.pid)
		if (!command) return kill('SIGKILL')
		try {
			process.kill(command, signal)
		} catch {}
		// As execa does, a command still running a while after SIGTERM is killed
		const {forceKillAfterTimeout = true} = killOptions
		if ((signal === 'SIGTERM' || signal === SIGTERM) && forceKillAfterTimeout !== false) {
			const wait = forceKillAfterTimeout === true ? 5000 : forceKillAfterTimeout
			setTimeout(() => kill('SIGKILL'), wait).unref()
		}
		return true
	}) as typeof child.kill
	// A failure names the command that was asked for, as it did before commands
	// were sandboxed, and not the wrapper around it. This runs before whoever
	// awaits the command sees the error.
	child.catch((error: {command?: string; escapedCommand?: string; message?: string; shortMessage?: string}) => {
		const asked = [command, ...arguments_].join(' ')
		const wrapper = error.command
		if (!wrapper) return
		if (error.message) error.message = error.message.replace(wrapper, asked)
		if (error.shortMessage) error.shortMessage = error.shortMessage.replace(wrapper, asked)
		error.command = asked
		error.escapedCommand = asked
	})
	return child
}

const {SIGKILL, SIGTERM} = constants.signals
type Signal = NodeJS.Signals | number

// The command's process, given bubblewrap's. The first process in the sandbox
// is bubblewrap's too, there to collect what the command leaves behind, and
// the command is the first thing that one starts. Before the command has
// started there is none.
function commandProcess(bubblewrap: number | undefined) {
	const firstChild = (process: number) => {
		const [child] = readFileSync(`/proc/${process}/task/${process}/children`, 'utf8').split(' ')
		return Number(child) || undefined
	}
	try {
		const first = bubblewrap && firstChild(bubblewrap)
		return first ? firstChild(first) : undefined
	} catch {
		return undefined
	}
}

// The descriptor bubblewrap reads the command's system call filter from
const FILTER_DESCRIPTOR = 9

// How every command starts, given its filter's file, its cgroup if it has one,
// and the command. It puts itself in its cgroup as the first thing it does,
// while it is still root and before there is anything to limit: put there by
// umbreld once it had started, whatever it had already started would be left
// outside. It opens its filter, then becomes the command. If either fails, the
// command does not run.
//
// When umbreld's service is stopped, everything it started is told to stop at
// once, bubblewrap as well as the command inside it. Bubblewrap ending is what
// kills the command, so from here on SIGTERM is held back, which bubblewrap
// inherits. The command is started with it let through again, and gets to
// finish what it was doing as it would have unsandboxed.
const START = `[ -z "$2" ] || echo $$ > "$2/cgroup.procs" || exit 1; exec ${FILTER_DESCRIPTOR}< "$1"; shift 2; exec env --block-signal=TERM "$@"`

// The files holding the two system call filters, compiled when first needed.
// They are the same for every umbreld of this version, so one starting while
// another runs replaces them with what they already hold.
// umbreld runs sandboxed commands from more than one thread, and each thread
// has this module to itself, counters and all. Whatever one of them names, a
// cgroup or a file on its way into place, carries this so that no two can
// pick the same name.
const INSTANCE = `${process.pid}-${threadId}`

const filterFiles = new Map<boolean, string>()
function systemCallFilterFile(network: boolean) {
	let file = filterFiles.get(network)
	if (!file) {
		if (process.arch !== 'x64' && process.arch !== 'arm64') {
			throw new Error(`No system call filter for ${process.arch}`)
		}
		const architecture: Architecture = process.arch
		const directory = '/run/umbrel-sandbox'
		file = `${directory}/system-calls-${network ? 'with' : 'without'}-network`
		mkdirSync(directory, {recursive: true})
		// Never there half written: it is put in place whole
		writeFileSync(`${file}.${INSTANCE}`, systemCallFilter({network, architecture}))
		renameSync(`${file}.${INSTANCE}`, file)
		filterFiles.set(network, file)
	}
	return file
}

// Where the cgroups of sandboxed commands are made, or false where there is
// nowhere to make them. umbreld's systemd unit hands umbreld its cgroup to
// divide up, with umbreld itself in the subgroup `main`. Run any other way, as
// in development, a command has no limits.
let limitsDirectory: string | false | undefined
let limited = 0

// Makes a cgroup for one command, with its limits, and returns its path
function limitsFor(sandbox: Sandbox) {
	let cgroup: string | undefined
	let made = false
	try {
		if (limitsDirectory === undefined) {
			limitsDirectory = false
			const unit = /^0::(\/.+)\/main$/m.exec(readFileSync('/proc/self/cgroup', 'utf8'))?.[1]
			if (unit) {
				// A cgroup can only limit its children in what its parent lets it
				const directory = `/sys/fs/cgroup${unit}/sandbox`
				writeFileSync(`/sys/fs/cgroup${unit}/cgroup.subtree_control`, '+memory +cpu +pids')
				mkdirSync(directory, {recursive: true})
				writeFileSync(`${directory}/cgroup.subtree_control`, '+memory +cpu +pids')
				limitsDirectory = directory
			}
		}
		if (!limitsDirectory) return
		// These are files of the kernel's, in memory: writing them never waits
		cgroup = `${limitsDirectory}/${INSTANCE}-${limited++}`
		mkdirSync(cgroup)
		made = true
		if (sandbox.memoryLimit !== undefined) {
			writeFileSync(`${cgroup}/memory.max`, String(Math.floor(sandbox.memoryLimit)))
			// Without this the limit is no limit: what is over it goes to swap
			writeFileSync(`${cgroup}/memory.swap.max`, '0')
			// Everything in the sandbox goes together, not whichever part the kernel picks
			writeFileSync(`${cgroup}/memory.oom.group`, '1')
		}
		if (sandbox.cpuLimit !== undefined) {
			writeFileSync(`${cgroup}/cpu.max`, `${Math.round(sandbox.cpuLimit * 100_000)} 100000`)
		}
		writeFileSync(`${cgroup}/pids.max`, String(TASKS_LIMIT))
		return cgroup
	} catch {
		// No cgroup could be made for this command, so it runs without one
		// rather than not at all. Only a cgroup made here is removed: removing
		// one ends everything in it.
		if (cgroup && made) void removeLimits(cgroup)
	}
}

// Ends whatever a finished command left running and removes its cgroup
async function removeLimits(cgroup: string) {
	await writeFile(`${cgroup}/cgroup.kill`, '1').catch(() => {})
	// A cgroup can only be removed once the last process in it is gone
	for (let attempt = 0; attempt < 50; attempt++) {
		const removed = await rmdir(cgroup).then(
			() => true,
			(error: NodeJS.ErrnoException) => error.code === 'ENOENT',
		)
		if (removed) return
		await sleep(100)
	}
}

// The group that owns the GPU's render node, if there is one. The node lives
// in memory, so asking never waits on a disk.
function renderGroupId() {
	try {
		return statSync(GPU_RENDER_NODE).gid
	} catch {
		return undefined
	}
}
