import pRetry from 'p-retry'
import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import type {Sandbox} from './sandbox.ts'

// Runs a shell script through umbreld's own `sandboxed()` on the device, with
// the policy given as JSON and whatever the script reads on its standard input
const guestRunner = '/root/run-sandboxed.mjs'
const runner = `
import {sandboxed} from '/opt/umbreld/source/modules/utilities/sandbox.ts'

const sandbox = {network: false, gpu: false, readablePaths: [], writablePaths: [], ...JSON.parse(process.argv[3] ?? '{}')}
try {
	const {stdout} = await sandboxed('sh', ['-c', process.argv[2]], sandbox, {stdio: ['inherit', 'pipe', 'inherit'], reject: false})
	process.stdout.write(stdout)
} catch (error) {
	process.stdout.write('threw: ' + error.message)
}
`

// Runs the same from the cgroup umbreld itself runs in, which is where the
// limits of a sandboxed command can be applied
const umbreldCgroup = '/sys/fs/cgroup/system.slice/umbrel.service'
const guestLimitedRunner = '/root/run-sandboxed-limited.sh'
const limitedRunner = `echo $$ > ${umbreldCgroup}/main/cgroup.procs && exec node ${guestRunner} "$@"`

// Runs limited commands from two threads at once, as umbreld does from its
// main thread and the thread that indexes files, and prints how many failed
// in each
const guestThreadsRunner = '/root/run-sandboxed-threads.mjs'
const threadsRunner = `
import {Worker, isMainThread, parentPort} from 'node:worker_threads'
import {sandboxed} from '/opt/umbreld/source/modules/utilities/sandbox.ts'

const policy = {network: false, gpu: false, readablePaths: [], writablePaths: [], memoryLimit: 256 * 1024 ** 2}
const run = async () => {
	let failed = 0
	for (let round = 0; round < 5; round++) {
		const results = await Promise.all(
			Array.from({length: 8}, () => sandboxed('sleep', ['0.3'], policy, {reject: false})),
		)
		failed += results.filter((result) => result.exitCode !== 0).length
	}
	return failed
}
if (isMainThread) {
	const worker = new Worker(new URL(import.meta.url))
	const fromWorker = new Promise((resolve, reject) => {
		worker.once('message', resolve)
		worker.once('error', reject)
	})
	const failedHere = await run()
	process.stdout.write(failedHere + ' ' + (await fromWorker))
} else {
	parentPort.postMessage(await run())
}
`

describe('sandboxed commands', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		// A registered device has the data a sandboxed command must not reach
		await umbreld.registerAndLogin()
		await umbreld.vm.sshAsRoot(`cat > ${guestRunner} <<'RUNNER'\n${runner}\nRUNNER`)
		await umbreld.vm.sshAsRoot(`cat > ${guestLimitedRunner} <<'RUNNER'\n${limitedRunner}\nRUNNER`)
		await umbreld.vm.sshAsRoot(`cat > ${guestThreadsRunner} <<'RUNNER'\n${threadsRunner}\nRUNNER`)
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	// What a script prints when run in the sandbox, as root starts it like
	// umbreld does. Without a policy it is allowed nothing.
	function sandboxed(script: string, redirection = '</dev/null', policy: Partial<Sandbox> = {}) {
		return umbreld.vm.sshAsRoot(`node ${guestRunner} '${script}' '${JSON.stringify(policy)}' ${redirection}`)
	}

	function limited(script: string, policy: Partial<Sandbox> = {}) {
		return umbreld.vm.sshAsRoot(`sh ${guestLimitedRunner} '${script}' '${JSON.stringify(policy)}' </dev/null`)
	}

	test('runs as nobody, with no capability and no way to gain one', async () => {
		// The command is no longer root, and is in no group but nobody's
		expect(await sandboxed('id -u; id -g; id -G')).toBe('65534\n65534\n65534')

		// It holds no capability, and nothing it runs can be given one
		const status = await sandboxed('grep -E "^(CapPrm|CapEff|CapBnd|NoNewPrivs):" /proc/self/status')
		expect(status.split('\n').map((line) => line.split(/\s+/)[1])).toStrictEqual([
			'0000000000000000',
			'0000000000000000',
			'0000000000000000',
			'1',
		])

		// A user namespace of its own would hand it capabilities there, and a
		// mount would change what it can see: both are refused
		expect(await sandboxed('unshare --user true 2>/dev/null && echo allowed || echo refused')).toBe('refused')
		expect(await sandboxed('mount -t tmpfs none /tmp 2>/dev/null && echo allowed || echo refused')).toBe('refused')
	})

	test('sees the programs of the OS and no file of the user, the apps or umbreld', async () => {
		// The data is there for root to see
		expect(await umbreld.vm.sshAsRoot('test -d /home/umbrel/umbrel/secrets && echo yes')).toBe('yes')

		// In the sandbox there is no /home, /run, /var or /sys at all
		expect(await sandboxed('ls /')).toBe(['bin', 'dev', 'etc', 'lib', 'lib64', 'proc', 'tmp', 'usr'].join('\n'))

		// Of /etc there is only what the loader and ImageMagick need
		expect(await sandboxed('ls /etc')).toBe(['ImageMagick-7', 'alternatives', 'ld.so.cache'].join('\n'))

		// The system bus and Docker's socket are files it cannot reach either
		expect(
			await umbreld.vm.sshAsRoot('test -S /run/dbus/system_bus_socket && test -S /run/docker.sock && echo yes'),
		).toBe('yes')
		expect(await sandboxed('test -e /run/dbus/system_bus_socket || test -e /run/docker.sock || echo neither')).toBe(
			'neither',
		)
	})

	test('cannot write to the OS, and what it writes to /tmp is gone with it', async () => {
		expect(await sandboxed('touch /usr/bin/planted 2>/dev/null && echo written || echo refused')).toBe('refused')

		// Its /tmp starts empty and is its own
		expect(await sandboxed('ls -A /tmp | wc -l; touch /tmp/planted && ls /tmp')).toBe('0\nplanted')
		expect(await umbreld.vm.sshAsRoot('test -e /tmp/planted && echo yes || echo no')).toBe('no')
	})

	test('sees no process but its own', async () => {
		// The device runs umbreld and everything else
		const processes = 'ls /proc | grep -c "^[0-9]"'
		expect(Number(await umbreld.vm.sshAsRoot(processes))).toBeGreaterThan(20)

		// The sandbox holds its init, the shell and the two commands of the pipe
		expect(Number(await sandboxed(processes))).toBeLessThanOrEqual(4)
	})

	test('has no network', async () => {
		// umbreld answers on the device itself
		const request = 'curl --silent --max-time 5 --output /dev/null http://127.0.0.1/; echo $?'
		expect(await umbreld.vm.sshAsRoot(request)).toBe('0')

		// The sandbox has a loopback interface of its own, where nothing listens, and no other
		expect(await sandboxed(request)).toBe('7')
		expect(await sandboxed('tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d " "')).toBe('lo')
	})

	test("inherits nothing of umbreld's environment", async () => {
		const environment = await umbreld.vm.sshAsRoot(`SECRET=hunter2 node ${guestRunner} 'env | sort' '{}' </dev/null`)
		expect(environment).toBe('LANG=C.UTF-8\nPATH=/usr/bin:/usr/sbin\nPWD=/')
	})

	test('reads the file it is handed, whoever owns it, and cannot write to it', async () => {
		// A file only root can open, as an upload is while umbreld is still writing it
		await umbreld.vm.sshAsRoot('printf private > /root/handed && chmod 600 /root/handed')

		// Handed over open, on standard input, it is read
		expect(await sandboxed('cat', '</root/handed')).toBe('private')

		// Opening it again to write is up to the file's permissions, which nobody has none of
		const write = '(echo changed >/dev/stdin) 2>/dev/null && echo written || echo refused'
		expect(await sandboxed(write, '</root/handed')).toBe('refused')
		expect(await umbreld.vm.sshAsRoot('cat /root/handed')).toBe('private')
	})

	test('as root, opens the file it is handed at the path it is shown at, and cannot write to it', async () => {
		await umbreld.vm.sshAsRoot('printf private > /root/shown && chmod 600 /root/shown')
		const shown = {user: 'root' as const, readableFile: {descriptor: 0, path: '/shown'}}

		// The file is there to open, though nothing of where it came from is
		expect(await sandboxed('cat /shown; ls /root 2>/dev/null', '</root/shown', shown)).toBe('private')

		// Root as it is, it cannot write to it
		const write = '(echo changed >/shown) 2>/dev/null && echo written || echo refused'
		expect(await sandboxed(write, '</root/shown', shown)).toBe('refused')
		expect(await umbreld.vm.sshAsRoot('cat /root/shown')).toBe('private')
	})

	test('reaches the network only when allowed to', async () => {
		const request = 'curl --silent --max-time 5 --output /dev/null http://127.0.0.1/; echo $?'
		expect(await sandboxed(request, '</dev/null', {network: true})).toBe('0')

		// With the network come the files that resolve a name
		expect(await sandboxed('getent hosts localhost | wc -l', '</dev/null', {network: true})).toBe('1')
	})

	test('reads and writes only the paths it is given', async () => {
		// One directory to read, one to write, and one it is not told about
		const made = await umbreld.vm.sshAsRoot(`
			mkdir -p /srv/sandbox/readable /srv/sandbox/writable /srv/sandbox/hidden &&
			printf readable > /srv/sandbox/readable/file && printf hidden > /srv/sandbox/hidden/file &&
			chmod 777 /srv/sandbox/readable /srv/sandbox/writable && echo yes
		`)
		expect(made).toBe('yes')
		const policy = {readablePaths: ['/srv/sandbox/readable'], writablePaths: ['/srv/sandbox/writable']}

		// Only the two it was given exist for it
		expect(await sandboxed('ls /srv/sandbox', '</dev/null', policy)).toBe('readable\nwritable')
		expect(await sandboxed('cat /srv/sandbox/readable/file', '</dev/null', policy)).toBe('readable')

		// A readable path cannot be written to, though its permissions would let nobody
		const write = '(echo changed > /srv/sandbox/readable/file) 2>/dev/null && echo written || echo refused'
		expect(await sandboxed(write, '</dev/null', policy)).toBe('refused')

		// What it writes to a writable path is there afterwards, and is nobody's
		expect(await sandboxed('printf written > /srv/sandbox/writable/file && echo done', '</dev/null', policy)).toBe(
			'done',
		)
		expect(await umbreld.vm.sshAsRoot('cat /srv/sandbox/writable/file; stat -c " %U" /srv/sandbox/writable/file')).toBe(
			'written nobody',
		)

		// A readable path stays that inside a writable one, and a writable path
		// inside a readable one
		const nested = await umbreld.vm.sshAsRoot(`
			mkdir -p /srv/sandbox/writable/readable /srv/sandbox/readable/writable &&
			chmod 777 /srv/sandbox/writable/readable /srv/sandbox/readable/writable && echo yes
		`)
		expect(nested).toBe('yes')
		const attempt = (directory: string) => `(echo x > ${directory}/new) 2>/dev/null && echo written || echo refused`
		for (const [readable, writable] of [
			['/srv/sandbox/writable/readable', '/srv/sandbox/writable'],
			['/srv/sandbox/readable', '/srv/sandbox/readable/writable'],
		]) {
			const nestedPolicy = {readablePaths: [readable], writablePaths: [writable]}
			expect(await sandboxed(`${attempt(readable)}; ${attempt(writable)}`, '</dev/null', nestedPolicy)).toBe(
				'refused\nwritten',
			)
		}
	})

	test('runs as the user it is given, and never as root', async () => {
		// The owner of the user's files, for a command whose output must be theirs
		const policy = {writablePaths: ['/srv/sandbox/writable'], user: {userId: 1000, groupId: 1000}}
		expect(await sandboxed('id -u; id -g; touch /srv/sandbox/writable/theirs', '</dev/null', policy)).toBe('1000\n1000')
		expect(await umbreld.vm.sshAsRoot('stat -c "%U:%G" /srv/sandbox/writable/theirs')).toBe('umbrel:umbrel')

		// It has no more capability for it, and still sees nothing of theirs
		const status = await sandboxed('grep -E "^CapEff:" /proc/self/status; ls /home 2>&1 | wc -l', '</dev/null', policy)
		expect(status.replace(/\s+/g, ' ')).toBe('CapEff: 0000000000000000 1')

		// Root by number is refused before anything is started: it has to be asked for by name
		const root = {user: {userId: 0, groupId: 0}}
		expect(await sandboxed('id -u', '</dev/null', root)).toBe(
			"threw: A sandboxed command only runs as root when its user is 'root'",
		)
	})

	test('as root, acts as root on the paths it is given and on nothing else', async () => {
		// Files of two owners, closed to everyone else, to copy with their owners kept
		const made = await umbreld.vm.sshAsRoot(`
			mkdir -p /srv/sandbox/root-source /srv/sandbox/root-target &&
			printf theirs > /srv/sandbox/root-source/theirs && chown 1000:1000 /srv/sandbox/root-source/theirs && chmod 600 /srv/sandbox/root-source/theirs &&
			printf daemons > /srv/sandbox/root-source/daemons && chown 1:1 /srv/sandbox/root-source/daemons && chmod 660 /srv/sandbox/root-source/daemons && echo yes
		`)
		expect(made).toBe('yes')
		const policy = {
			user: 'root' as const,
			readablePaths: ['/srv/sandbox/root-source'],
			writablePaths: ['/srv/sandbox/root-target'],
		}

		// It is root, and can read, write and hand over files as root does
		const copy =
			'id -u; rsync -a /srv/sandbox/root-source/ /srv/sandbox/root-target/ && stat -c "%u:%g %a" /srv/sandbox/root-target/theirs /srv/sandbox/root-target/daemons'
		expect(await sandboxed(copy, '</dev/null', policy)).toBe('0\n1000:1000 600\n1:1 660')

		// The two paths are all it sees of the device, and it has no /proc
		// at all: root could change kernel settings there that run commands
		// on the host
		expect(await sandboxed('ls /; ls /srv/sandbox', '</dev/null', policy)).toBe(
			['bin', 'dev', 'etc', 'lib', 'lib64', 'srv', 'tmp', 'usr', 'root-source', 'root-target'].join('\n'),
		)

		// Being root gets it nowhere else: not the path it may only read, not
		// the OS, not a device node, not a mount, not a /proc of its own making
		const attempts = [
			'echo changed > /srv/sandbox/root-source/theirs',
			'touch /usr/bin/planted',
			'mknod /tmp/disk b 8 0',
			'mount -t tmpfs none /tmp',
			'mount -t proc proc /tmp',
			'unshare --user --mount --pid --fork mount -t proc proc /tmp',
		]
		for (const attempt of attempts) {
			expect(await sandboxed(`(${attempt}) 2>/dev/null && echo done || echo refused`, '</dev/null', policy)).toBe(
				'refused',
			)
		}

		// It has no network unless it is allowed one
		const request = 'curl --silent --max-time 5 --output /dev/null http://127.0.0.1/; echo $?'
		expect(await sandboxed(request, '</dev/null', policy)).toBe('7')
		expect(await sandboxed(request, '</dev/null', {...policy, network: true})).toBe('0')

		// The GPU's drivers need the /proc a root command must not have
		expect(await sandboxed('true', '</dev/null', {user: 'root', gpu: true})).toBe(
			'threw: A sandboxed command cannot use the GPU as root',
		)
	})

	test('as root, creates device files only when allowed to, and can never open one', async () => {
		// A character device and what Docker leaves where a file was deleted
		// from an image layer, as apps keep them in their data. They are made
		// where apps' data is: the OS's own filesystem is an overlay, which
		// uses those markers itself and lets nobody create one.
		await umbreld.vm.sshAsRoot(`
			mkdir -p /home/umbrel/sandbox-devices/source /home/umbrel/sandbox-devices/target /home/umbrel/sandbox-devices/refused &&
			mknod /home/umbrel/sandbox-devices/source/zero c 1 5 && chown 999:998 /home/umbrel/sandbox-devices/source/zero && chmod 666 /home/umbrel/sandbox-devices/source/zero &&
			mknod /home/umbrel/sandbox-devices/source/whiteout c 0 0
		`)
		const copyTo = (target: string) =>
			`rsync -a /home/umbrel/sandbox-devices/source/ ${target}/ 2>/dev/null; echo $?; stat -c "%n %F %t:%T %u:%g %a" ${target}/* 2>/dev/null`
		const policy = (target: string) => ({
			user: 'root' as const,
			readablePaths: ['/home/umbrel/sandbox-devices/source'],
			writablePaths: [target],
		})

		// Allowed to, a copy keeps them as they were
		const allowed = {...policy('/home/umbrel/sandbox-devices/target'), deviceFiles: true}
		expect(await sandboxed(copyTo('/home/umbrel/sandbox-devices/target'), '</dev/null', allowed)).toBe(
			[
				'0',
				'/home/umbrel/sandbox-devices/target/whiteout character special file 0:0 0:0 644',
				'/home/umbrel/sandbox-devices/target/zero character special file 1:5 999:998 666',
			].join('\n'),
		)

		// Without it the device is refused, and only the marker, which is no
		// device at all, is copied
		expect(
			await sandboxed(
				copyTo('/home/umbrel/sandbox-devices/refused'),
				'</dev/null',
				policy('/home/umbrel/sandbox-devices/refused'),
			),
		).toBe(['23', '/home/umbrel/sandbox-devices/refused/whiteout character special file 0:0 0:0 644'].join('\n'))

		// Creating a device is not using one. Wherever the command can put one,
		// opening it is refused: the path it writes to, /tmp and /dev.
		for (const device of [
			'/home/umbrel/sandbox-devices/target/zero',
			'/home/umbrel/sandbox-devices/target/made',
			'/tmp/made',
			'/dev/made',
		]) {
			const open = `[ -e ${device} ] || mknod ${device} c 1 5; head -c 1 ${device} 2>/dev/null | wc -c`
			expect(await sandboxed(open, '</dev/null', allowed)).toBe('0')
		}
		// The devices the sandbox itself provides still work
		expect(await sandboxed('head -c 1 /dev/zero | wc -c', '</dev/null', allowed)).toBe('1')

		// Only a root command can be allowed to
		expect(await sandboxed('true', '</dev/null', {deviceFiles: true})).toBe(
			'threw: A sandboxed command only creates device files as root',
		)
	})

	test('cannot ask the kernel for a namespace or a mount, as nobody or as root', async () => {
		// Each of these is how a sandbox is made, and so how one could be remade
		// with more in it. A root command has no user namespace stopping it:
		// only the system call filter does.
		const attempts = ['unshare --user true', 'unshare --mount true', 'unshare --uts true', 'unshare --net true']
		for (const attempt of attempts) {
			const script = `(${attempt}) 2>/dev/null && echo done || echo refused`
			expect(await sandboxed(script)).toBe('refused')
			expect(await sandboxed(script, '</dev/null', {user: 'root'})).toBe('refused')
		}
	})

	test('creates only the kinds of socket its network access calls for', async () => {
		// Tries a socket of each kind and prints how it went: local, internet,
		// internet version 6, the kernel's address information, raw packets and
		// the kernel's crypto interface. 97 is "no such kind of socket".
		const sockets =
			'perl -MSocket -e "print join q( ), map { socket(my \\$s, \\$_, SOCK_DGRAM, 0) ? q(ok) : \\$!+0 } @ARGV" 1 2 10 16 17 38'
		expect(await sandboxed(sockets)).toBe('ok 97 97 97 97 97')
		expect(await sandboxed(sockets, '</dev/null', {user: 'root'})).toBe('ok 97 97 97 97 97')
		expect(await sandboxed(sockets, '</dev/null', {network: true})).toBe('ok ok ok ok 97 97')
	})

	test('still starts processes and threads', async () => {
		// The filter refuses the newer of the two calls that start a thread,
		// which the C library answers by using the older
		expect(await sandboxed('seq 1 5 | sort -r | head -n 1; (sleep 0.1 & wait; echo waited)')).toBe('5\nwaited')
		const encode =
			'ffmpeg -nostdin -v error -f lavfi -i testsrc2=d=0.2:s=320x240 -c:v libx264 -threads 4 -f null - && echo encoded'
		expect(await sandboxed(encode)).toBe('encoded')
	})

	test('fails as the command it ran, without the sandbox around it in the error', async () => {
		// What a failed command reports is what umbreld logs and what reaches
		// the user, so it reads as it did before the command was sandboxed
		const failure = await umbreld.vm.sshAsRoot(`cd /opt/umbreld && node --input-type=module --eval '
			import {sandboxed} from "/opt/umbreld/source/modules/utilities/sandbox.ts"
			const policy = {network: false, gpu: false, readablePaths: [], writablePaths: []}
			await sandboxed("sh", ["-c", "echo broken >&2; exit 3"], policy).catch((error) => {
				console.log([error.shortMessage, error.command, error.exitCode, error.stderr].join(" | "))
			})
		'`)
		expect(failure).toBe(
			'Command failed with exit code 3: sh -c echo broken >&2; exit 3 | sh -c echo broken >&2; exit 3 | 3 | broken',
		)
	})

	test('has the variables it is given by name, and starts in the directory it is given', async () => {
		const started = await umbreld.vm.sshAsRoot(`cd /opt/umbreld && SECRET=hunter2 node --input-type=module --eval '
			import {sandboxed} from "/opt/umbreld/source/modules/utilities/sandbox.ts"
			const policy = {network: false, gpu: false, readablePaths: [], writablePaths: []}
			const options = {env: {GIVEN: "by name"}, cwd: "/usr/share"}
			console.log((await sandboxed("sh", ["-c", "env | sort; pwd"], policy, options)).stdout)
			// A directory it cannot see is not swapped for one it can
			await sandboxed("pwd", [], policy, {cwd: "/home/umbrel"}).then(
				({stdout}) => console.log("started in " + stdout),
				() => console.log("did not start"),
			)
		'`)
		expect(started).toBe(
			'GIVEN=by name\nLANG=C.UTF-8\nPATH=/usr/bin:/usr/sbin\nPWD=/usr/share\n/usr/share\ndid not start',
		)
	})

	test('is the one a signal reaches, and is killed when it does not stop', async () => {
		// What umbreld started is bubblewrap. A signal that ended it there would
		// take the command with it before the command could finish up.
		const stopped = await umbreld.vm.sshAsRoot(`cd /opt/umbreld && node --input-type=module --eval '
			import {sandboxed} from "/opt/umbreld/source/modules/utilities/sandbox.ts"
			const policy = {network: false, gpu: false, readablePaths: [], writablePaths: []}
			const stop = async (script, signal) => {
				const options = {reject: false, detached: true}
				const command = sandboxed("sh", ["-c", script + "; echo started; while :; do sleep 0.1; done"], policy, options)
				await new Promise((resolve) => command.stdout.once("data", resolve))
				signal(command)
				const {stdout, exitCode, signal: endedBy} = await command
				console.log([stdout.replace("\\n", " then "), exitCode, endedBy].join(" | "))
			}
			const finish = (signal) => "finish() { echo finished; exit 0; }; trap finish " + signal
			// One that finishes up when asked to stop
			await stop(finish("INT"), (command) => command.kill("SIGINT"))
			// Stopping umbreld tells everything it started to stop at once,
			// bubblewrap as well as the command. The command still gets to finish
			// up, and one with nothing to finish stops there.
			const everything = (command) => process.kill(-command.pid, "SIGTERM")
			await stop(finish("TERM"), everything)
			await stop(":", everything)
			// One that carries on regardless
			await stop("trap : TERM", (command) => command.kill("SIGTERM", {forceKillAfterTimeout: 500}))
		'`)
		expect(stopped).toBe(
			['started then finished | 0 | ', 'started then finished | 0 | ', 'started | 143 | ', 'started |  | SIGKILL'].join(
				'\n',
			),
		)
	})

	test('starts on a device with no GPU when it is allowed one', async () => {
		// The VM has no GPU to pass on. Being allowed one must not need one.
		expect(await sandboxed('echo started', '</dev/null', {gpu: true})).toBe('started')
	})

	test('umbreld runs where it can limit what it starts', async () => {
		const umbreldProcess = await umbreld.vm.sshAsRoot('systemctl show umbrel --property MainPID --value')
		expect(await umbreld.vm.sshAsRoot(`cat /proc/${umbreldProcess.trim()}/cgroup`)).toBe(
			'0::/system.slice/umbrel.service/main',
		)
	})

	test('is killed, with all it started, when it holds more memory than its limit', async () => {
		// Files in /tmp are held in memory, so they count
		const fill = 'head -c 128M /dev/zero > /tmp/fill; echo survived'
		expect(await limited(fill, {memoryLimit: 64 * 1024 ** 2})).toBe('')
		expect(await limited(fill, {memoryLimit: 512 * 1024 ** 2})).toBe('survived')
		expect(await limited(fill)).toBe('survived')

		// As root too
		expect(await limited(fill, {memoryLimit: 64 * 1024 ** 2, user: 'root'})).toBe('')
		expect(await limited(fill, {memoryLimit: 512 * 1024 ** 2, user: 'root'})).toBe('survived')
	})

	test('uses no more CPU than its limit', async () => {
		// The CPU time, in hundredths of a second, of a loop that is busy for two seconds
		const busy = 'timeout 2 sh -c "while :; do :; done"; times > /tmp/times; tail -n 1 /tmp/times'
		const hundredths = (times: string) => {
			const [, minutes, seconds, fraction] = /^(\d+)m(\d+)\.(\d\d)/.exec(times)!
			return (Number(minutes) * 60 + Number(seconds)) * 100 + Number(fraction)
		}
		// A tenth of a core is a fifth of a second of it. The margins are wide
		// because the VM shares its host's cores with other VMs.
		expect(hundredths(await limited(busy, {cpuLimit: 0.1}))).toBeLessThan(60)
		expect(hundredths(await limited(busy))).toBeGreaterThan(100)
	})

	test('is told how many threads its CPU limit has room for', async () => {
		const threads = 'echo "${OMP_NUM_THREADS:-any number}"'
		expect(await limited(threads, {cpuLimit: 0.1})).toBe('1')
		expect(await limited(threads, {cpuLimit: 2})).toBe('2')
		expect(await limited(threads)).toBe('any number')
	})

	test('starts no more than a few hundred processes at once', async () => {
		// How many of a thousand long sleeps the command got to start, counted
		// without starting anything else
		const count =
			'(i=0; while [ $i -lt 1000 ]; do sleep 30 & i=$((i+1)); echo $i > /tmp/started; done) 2>/dev/null; read started < /tmp/started; echo $started'
		const started = Number(await limited(count))
		expect(started).toBeGreaterThan(400)
		expect(started).toBeLessThan(512)
	})

	test('keeps the commands of two threads apart', async () => {
		// Each thread counts its own commands. Were their cgroups named by that
		// count alone, two commands would share one, and the first to finish
		// would end the other when it removed it.
		const failed = await umbreld.vm.sshAsRoot(
			`sh -c 'echo $$ > ${umbreldCgroup}/main/cgroup.procs && exec node ${guestThreadsRunner}'`,
		)
		expect(failed).toBe('0 0')
	})

	test('leaves no cgroup behind', async () => {
		await limited('sleep 30 & echo started', {memoryLimit: 64 * 1024 ** 2})
		const left = `find ${umbreldCgroup}/sandbox -mindepth 1 -type d | wc -l`
		await pRetry(async () => expect(await umbreld.vm.sshAsRoot(left)).toBe('0'), {retries: 20, minTimeout: 250})
	})

	test('never outlives the process that started it', async () => {
		// A sandboxed command that would run for an hour
		await umbreld.vm.sshAsRoot(`nohup node ${guestRunner} 'sleep 3600' '{}' </dev/null >/dev/null 2>&1 &`)
		const sleeping = 'pgrep -fx "sleep 3600" | wc -l'
		await pRetry(async () => expect(await umbreld.vm.sshAsRoot(sleeping)).toBe('1'), {retries: 20, minTimeout: 250})

		// Killing what started it, with no chance to clean up, takes it along
		await umbreld.vm.sshAsRoot(`pkill -KILL -f "^node ${guestRunner}"`)
		await pRetry(async () => expect(await umbreld.vm.sshAsRoot(sleeping)).toBe('0'), {retries: 20, minTimeout: 250})
	})
})
