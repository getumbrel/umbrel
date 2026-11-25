// @vm-requires-models
import nodePath from 'node:path'

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import fse from 'fs-extra'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

describe('Indexing gives way to everything else on the device', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	const home = () => `${umbreld.vm.dataDirectory}/home`
	// Each step waits for the models more than once
	const stepTimeout = 30 * 60_000

	// The services of the models that read the library, but for the one that
	// answers searches
	const models = ['index', 'passages', 'faces', 'text', 'speech'].map((name) => `umbrel-embeddings-${name}.service`)

	async function found(query: string) {
		const {results} = await umbreld.client.search.query.query({query, scope: 'everything', limit: 20})
		return results.map(({file}) => file.name)
	}

	// Waits for what `check` expects. On a virtual machine's CPU a model takes
	// a few seconds to load and a few more for each thing it reads. If it
	// never comes, says what the VM was doing meanwhile.
	async function eventually(check: () => Promise<unknown>) {
		try {
			await pRetry(check, {retries: 240, factor: 1, minTimeout: 2000, maxTimeout: 2000})
		} catch (error) {
			const state = await umbreld.vm
				.sshAsRoot(
					`
					grep -E 'MemAvailable|SwapTotal|SwapFree' /proc/meminfo | tr -s ' ' | tr '\\n' ' '; head -1 /proc/pressure/memory
					systemctl is-active ${models.join(' ')} | tr '\\n' ' '; echo
					dmesg | grep 'Killed process' | tail -5 | cut -c1-200
					journalctl -u 'umbrel-embeddings-*' -n 12 --no-pager -o cat | cut -c1-200
					journalctl -u umbrel -n 25 --no-pager -o cat | cut -c1-220
				`,
				)
				.catch(() => 'the VM gave no answer')
			throw new Error(`${(error as Error).message}\n${state}`, {cause: error})
		}
	}

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home', memory: 4096, models: true})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test(
		'reads a library one model at a time where there is not room for all of them',
		async () => {
			// Without swap, so that what is free is all the room there is: on a
			// device at rest what swap has room for counts as room too. Masked,
			// or systemd turns swap back on with the next unit it starts.
			await umbreld.vm.sshAsRoot('systemctl mask --runtime dev-zram0.swap; swapoff -a')

			// Something holds all but 2.6 GB of what is free, from here to the end
			// of these tests: enough for any one kind of model beside the gigabyte
			// the models leave the device, and not for two of them at once
			await umbreld.vm.sshAsRoot(`
				systemd-run --quiet --unit=tenant python3 -c "
import time
spare = int(next(line for line in open('/proc/meminfo') if line.startswith('MemAvailable')).split()[1]) // 1024
held = bytearray(max(0, spare - 2600) * 1024 * 1024)
for at in range(0, len(held), 4096): held[at] = 1
time.sleep(36000)"
			`)

			// Notes how many of the models are loaded, every second from here on
			await umbreld.vm.sshAsRoot(`
				nohup sh -c 'while true; do systemctl is-active ${models.join(' ')} | grep -cx active >> /tmp/models-loaded; sleep 1; done' > /dev/null 2>&1 < /dev/null &
			`)

			// Two photos and a document, for the models that read pictures, faces and text to each have something to read
			await umbreld.vm.sshAsRoot(`
				mkdir -p '${home()}/Photos' '${home()}/Documents' && cd '${home()}/Photos'
				convert -size 1200x900 xc:white -fill red -draw 'rectangle 350,200 850,700' square.png
				convert -size 1200x400 xc:white -pointsize 96 -fill black -annotate +60+220 'HOVERCRAFT EELS' sign.png
				echo 'Remember to feed the tortoise twice a week while we are away.' > '${home()}/Documents/note.txt'
				chown -R 1000:1000 '${home()}/Photos' '${home()}/Documents'
			`)

			// Everything is found by what is in it all the same: what a photo
			// shows, the words in one, and the words of a document
			await eventually(async () => {
				expect(await found('a red square')).toContain('square.png')
				expect(await found('hovercraft')).toContain('sign.png')
				expect(await found('tortoise')).toContain('note.txt')
			})

			// ... with never more than one model's services loaded at once: the
			// one that reads the words in pictures and the one that embeds what a
			// document says are the same lane's
			const loaded = (await umbreld.vm.sshAsRoot('sort -n /tmp/models-loaded | uniq')).trim().split('\n').map(Number)
			expect(Math.max(...loaded)).toBeLessThanOrEqual(2)
			expect(loaded).toContain(1)
		},
		stepTimeout,
	)

	test(
		'reads with the models that matter most first, one after the other',
		async () => {
			// A recording long enough that the speech models are still writing
			// it down when a photo arrives: seven seconds of someone reading
			// aloud (see the search tests), sixty times over
			const speech = await fse.readFile(nodePath.resolve(__dirname, '../photos/fixtures/speech.opus'))
			// Notes, four times a second from here on, how many of the models that
			// write speech down and the one that reads what it means are loaded
			await umbreld.vm.sshAsRoot(`
				nohup sh -c 'while true; do systemctl is-active umbrel-embeddings-speech.service umbrel-embeddings-passages.service | grep -cx active >> /tmp/speech-models-loaded; sleep 0.25; done' > /dev/null 2>&1 < /dev/null &
			`)
			await umbreld.vm.sshAsRoot(`
				mkdir -p '${home()}/Recordings' && cd '${home()}/Recordings'
				echo '${speech.toString('base64')}' | base64 -d > /tmp/reading.opus
				ffmpeg -nostdin -loglevel error -stream_loop 59 -i /tmp/reading.opus -c copy reading.opus
				chown -R 1000:1000 .
			`)
			await eventually(async () => {
				expect(
					(await umbreld.vm.sshAsRoot('systemctl is-active umbrel-embeddings-speech.service || true')).trim(),
				).toBe('active')
			})

			// The photo is for three kinds of model, which all wait for speech
			const since = (await umbreld.vm.sshAsRoot('date +%s')).trim()
			await umbreld.vm.sshAsRoot(`
				cd '${home()}/Photos' && convert -size 1200x900 xc:white -fill gold -draw 'polygon 600,100 700,400 1000,400 760,580 850,880 600,700 350,880 440,580 200,400 500,400' star.png && chown 1000:1000 star.png
			`)
			await eventually(async () => {
				expect(await found('a yellow star')).toContain('star.png')
				const {indexing} = await umbreld.client.search.status.query()
				expect(indexing.completed).toBe(indexing.total)
			})

			// They read it in turn: what it shows, then the faces in it, then the text
			const started = (
				await umbreld.vm.sshAsRoot(
					`journalctl -o cat --since @${since} -u 'umbrel-embeddings-*' | grep -o '^Started umbrel-embeddings-[a-z]*' | sed 's/.*-//'`,
				)
			)
				.trim()
				.split('\n')
			const first = (service: string) => started.indexOf(service)
			expect(first('index')).toBeGreaterThanOrEqual(0)
			expect(first('faces')).toBeGreaterThan(first('index'))
			expect(first('text')).toBeGreaterThan(first('faces'))

			// What was said is read for what it means once it has all been
			// written down: every passage of it has its embedding in the end ...
			const store = `${umbreld.vm.dataDirectory}/embeddings/embeddings.db`
			await eventually(async () => {
				const [waiting, embedded] = (
					await umbreld.vm.sshAsRoot(`python3 -c "
import sqlite3
store = sqlite3.connect('file:${store}?mode=ro', uri=True)
speech = store.execute('SELECT COUNT(embedding) FROM passages WHERE kind = ?', ('speech',)).fetchone()[0]
print(store.execute('SELECT COUNT(*) FROM unembedded').fetchone()[0], speech)"`)
				)
					.trim()
					.split(' ')
					.map(Number)
				expect(waiting).toBe(0)
				expect(embedded).toBeGreaterThan(0)
			})
			// ... made by a model that was never loaded beside the ones that wrote it down
			const together = (await umbreld.vm.sshAsRoot('sort -n /tmp/speech-models-loaded | uniq')).trim().split('\n')
			expect(Math.max(...together.map(Number))).toBe(1)
		},
		stepTimeout,
	)

	test(
		'leaves a library alone once its owner turns indexing off, and reads it again once it is on',
		async () => {
			// How far along each kind of work is, with everything read so far
			const before = await umbreld.client.search.indexing.query()
			expect(before.enabled).toBe(true)
			for (const kind of ['previews', 'embedding', 'text', 'faces', 'speech'] as const) {
				expect(before.progress[kind].total).toBeGreaterThan(0)
				expect(before.progress[kind].completed).toBe(before.progress[kind].total)
			}

			// Turned off, a photo that arrives is not read, no model is loaded for
			// it, and Search says why. Nor is a video that arrives after it.
			expect(await umbreld.client.search.setIndexing.mutate({enabled: false})).toBe(false)
			await umbreld.vm.sshAsRoot(`
				cd '${home()}/Photos' && convert -size 1200x900 xc:white -fill purple -draw 'rectangle 150,300 1050,600' bar.png && chown 1000:1000 bar.png
				sleep 2
				ffmpeg -nostdin -loglevel error -f lavfi -i testsrc=duration=6:size=640x480:rate=10 -c:v mpeg4 bars.mp4 && chown 1000:1000 bars.mp4
			`)
			await eventually(async () => {
				const {progress} = await umbreld.client.search.indexing.query()
				// Their previews are still made: Photos shows them
				expect(progress.previews.completed).toBe(progress.previews.total)
				expect(progress.embedding.total).toBe(before.progress.embedding.total + 2)
				expect(progress.embedding.completed).toBe(before.progress.embedding.completed)
			})
			expect((await umbreld.client.search.status.query()).indexing.off).toBe(true)
			expect(await found('a purple bar')).not.toContain('bar.png')
			expect(
				(await umbreld.vm.sshAsRoot(`systemctl is-active ${models.join(' ')} | grep -cx active || true`)).trim(),
			).toBe('0')
			// What was read before is still found
			expect(await found('a red square')).toContain('square.png')

			// It stays off across a restart of umbreld
			await umbreld.vm.sshAsRoot('systemctl restart umbrel')
			await eventually(async () => expect((await umbreld.client.search.indexing.query()).enabled).toBe(false))
			await umbreld.vm.sshAsRoot('sleep 20')
			expect(await found('a purple bar')).not.toContain('bar.png')

			// Turned on again, it is read
			await umbreld.client.search.setIndexing.mutate({enabled: true})
			await eventually(async () => expect(await found('a purple bar')).toContain('bar.png'))
			await eventually(async () => {
				const {indexing} = await umbreld.client.search.status.query()
				expect(indexing.completed).toBe(indexing.total)
				expect(indexing.off).toBeUndefined()
			})

			// What the photo shows was read before what the video does, though the
			// video is the newer of the two: both were waiting when the models
			// were let at them
			const [photo, video] = (
				await umbreld.vm.sshAsRoot(`python3 -c "
import sqlite3
index = sqlite3.connect('file:${umbreld.vm.dataDirectory}/file-index/index.db?mode=ro', uri=True)
store = sqlite3.connect('file:${umbreld.vm.dataDirectory}/embeddings/embeddings.db?mode=ro', uri=True)
def first(name):
	hash = index.execute('SELECT blake3 FROM contents JOIN entries ON entries.content_id = contents.id WHERE entries.name = ?', (name,)).fetchone()[0]
	return store.execute('SELECT MIN(id) FROM vectors WHERE hash = ?', (hash,)).fetchone()[0]
print(first('bar.png'), first('bars.mp4'))"`)
			)
				.trim()
				.split(' ')
				.map(Number)
			expect(photo).toBeGreaterThan(0)
			expect(video).toBeGreaterThan(photo!)
		},
		stepTimeout,
	)

	test(
		'runs the models beneath everything else, and has them stopped first when memory runs out',
		async () => {
			// The models that read the library are in a slice of their own
			const slice = await umbreld.vm.sshAsRoot('systemctl show -p Slice,OOMScoreAdjust umbrel-embeddings-faces.service')
			expect(slice).toContain('Slice=umbrelbackground.slice')
			expect(slice).toContain('OOMScoreAdjust=1000')

			// The one that answers searches is not background work
			const query = await umbreld.vm.sshAsRoot('systemctl show -p Slice,OOMScoreAdjust umbrel-embeddings-query.service')
			expect(query).toContain('Slice=system.slice')
			expect(query).toContain('OOMScoreAdjust=0')

			// Something larger than any model runs beside them. Once no model is
			// left loaded from before, the moment one next is the kernel is asked
			// to stop whatever it would when out of memory. A model is loaded for
			// a second or two for one photo, so the VM watches for it itself.
			await umbreld.vm.sshAsRoot(`
				systemd-run --quiet --unit=larger python3 -c "
import time
held = bytearray(600 * 1024 * 1024)
for at in range(0, len(held), 4096): held[at] = 1
time.sleep(3600)"
				sleep 3
				while systemctl is-active ${models.join(' ')} | grep -qx active; do sleep 0.5; done
				nohup sh -c '
					until systemctl is-active ${models.join(' ')} | grep -qx active; do sleep 0.2; done
					cat /sys/fs/cgroup/umbrelbackground.slice/cpu.idle > /tmp/models-cpu-idle
					dmesg --clear
					echo f > /proc/sysrq-trigger
					sleep 2
					dmesg | grep "Killed process" > /tmp/kernel-stopped
				' > /dev/null 2>&1 < /dev/null &
				cd '${home()}/Photos' && convert -size 1200x900 xc:white -fill blue -draw 'circle 600,450 600,150' circle.png && chown 1000:1000 circle.png
			`)

			// It stops the model, and nothing else
			let stopped = ''
			await eventually(async () => {
				stopped = await umbreld.vm.sshAsRoot('cat /tmp/kernel-stopped')
				expect(stopped).toContain('Killed process')
			})
			expect(stopped.trim().split('\n')).toHaveLength(1)
			expect(stopped).toMatch(/oom_score_adj:1000/)
			// Their slice is at the top of the tree, where it is weighed against the
			// apps' and the machines', and gets the CPU only when they leave it
			expect((await umbreld.vm.sshAsRoot('cat /tmp/models-cpu-idle')).trim()).toBe('1')
			expect((await umbreld.vm.sshAsRoot('systemctl is-active larger umbrel')).trim()).toBe('active\nactive')
			await umbreld.vm.sshAsRoot('systemctl stop larger')

			// What the model was reading is read all the same
			await eventually(async () => expect(await found('a blue circle')).toContain('circle.png'))
		},
		stepTimeout,
	)

	test(
		'waits while there is no memory to spare, says so, and carries on when there is',
		async () => {
			// Nothing left to index, so nothing is waiting
			await eventually(async () => {
				const {indexing} = await umbreld.client.search.status.query()
				expect(indexing.completed).toBe(indexing.total)
				expect(indexing.waitingForMemory).toBeUndefined()
			})

			// Something takes all but a gigabyte of the memory there is, which is
			// what the models leave the device, and keeps it that way
			await umbreld.vm.sshAsRoot(`
				systemctl stop ${models.join(' ')}
				systemd-run --quiet --unit=hungry python3 -c "
import time
spare = lambda: int(next(line for line in open('/proc/meminfo') if line.startswith('MemAvailable')).split()[1]) // 1024
held = []
while True:
	if spare() <= 900:
		time.sleep(0.5)
		continue
	chunk = bytearray(32 * 1024 * 1024)
	for at in range(0, len(chunk), 4096): chunk[at] = 1
	held.append(chunk)"
			`)
			await eventually(async () => {
				const available = await umbreld.vm.sshAsRoot(`awk '/MemAvailable/ {print int($2 / 1024)}' /proc/meminfo`)
				expect(Number(available.trim())).toBeLessThan(1000)
				expect((await umbreld.vm.sshAsRoot(`awk '/SwapTotal/ {print $2}' /proc/meminfo`)).trim()).toBe('0')
			})

			// A photo that arrives now is not read: the models wait, and Search says so
			await umbreld.vm.sshAsRoot(`
				cd '${home()}/Photos' && convert -size 1200x900 xc:white -fill green -draw 'polygon 600,150 250,750 950,750' triangle.png && chown 1000:1000 triangle.png
			`)
			await eventually(async () => {
				expect((await umbreld.client.search.status.query()).indexing.waitingForMemory).toBe(true)
			})
			expect(await found('a green triangle')).not.toContain('triangle.png')
			expect(
				(await umbreld.vm.sshAsRoot(`systemctl is-active ${models.join(' ')} | grep -cx active || true`)).trim(),
			).toBe('0')

			// With the memory back, it is read
			await umbreld.vm.sshAsRoot('systemctl stop hungry')
			await eventually(async () => expect(await found('a green triangle')).toContain('triangle.png'))
			// ... and once every model has read it, nothing is waiting any more
			await eventually(async () => {
				const {indexing} = await umbreld.client.search.status.query()
				expect(indexing.completed).toBe(indexing.total)
				expect(indexing.waitingForMemory).toBeUndefined()
			})
		},
		stepTimeout,
	)

	test(
		'leaves the models unfetched where the device has no room for them, and tells the owner once',
		async () => {
			const full = `${umbreld.vm.dataDirectory}/full`
			const told = async () => (await umbreld.client.notifications.get.query()).includes('search-models-no-room')
			const left = async () =>
				Number(
					(await umbreld.vm.sshAsRoot(`journalctl -u umbrel -o cat | grep -c 'No room for the models' || true`)).trim(),
				)

			// As after an update that brings other models: the ones here are not
			// known to be the ones to use, and all of the disk but 4 GB is taken.
			// The models are to leave 5 GB free.
			await umbreld.vm.sshAsRoot(`
				fallocate -l $(( $(df --output=avail -B1 '${umbreld.vm.dataDirectory}' | tail -1) - 4 * 1024 * 1024 * 1024 )) '${full}'
				rm '${umbreld.vm.dataDirectory}/models/installed'
				echo 'The bins go out on Thursday.' > '${home()}/Documents/bins.txt' && chown 1000:1000 '${home()}/Documents/bins.txt'
			`)
			// Nothing is fetched, a search goes by name, and the owner is told why
			await eventually(async () => {
				expect(await umbreld.client.search.status.query()).toMatchObject({available: false, reason: 'starting'})
				expect(await told()).toBe(true)
			})
			expect(await found('bins')).toContain('bins.txt')

			// Told once: with the notification taken away it does not come back,
			// however often the models are still left for want of room
			await umbreld.client.notifications.clear.mutate('search-models-no-room')
			const before = await left()
			await eventually(async () => expect(await left()).toBeGreaterThan(before))
			await umbreld.client.search.status.query()
			await new Promise((resolve) => setTimeout(resolve, 5000))
			expect(await told()).toBe(false)

			// With room for them again they are there to use, and what arrived meanwhile is read
			await umbreld.vm.sshAsRoot(`rm '${full}'`)
			await eventually(async () => expect((await umbreld.client.search.status.query()).available).toBe(true))
			await eventually(async () => expect(await found('Thursday')).toContain('bins.txt'))
		},
		stepTimeout,
	)
})
