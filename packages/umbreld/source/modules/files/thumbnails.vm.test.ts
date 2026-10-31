import nodePath from 'node:path'

import fse from 'fs-extra'
import pRetry from 'p-retry'
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

const suiteRoot = '/Home/thumbnail-index-vm'
const guestHome = '/home/umbrel/umbrel/home'
const guestSuiteRoot = `${guestHome}/thumbnail-index-vm`
const guestThumbnailRoot = '/home/umbrel/umbrel/thumbnails'
const variant = 'preview-192-webp-v1'
const thumbnailUrlPattern = new RegExp(`^/api/files/thumbnail/content-${variant}-[a-f0-9]{64}\\.webp\\?path=`, 'i')

describe('content-addressed thumbnail index', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let masterImage: Buffer

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
		await umbreld.client.files.createDirectory.mutate({path: suiteRoot})

		masterImage = await fse.readFile(nodePath.resolve(__dirname, 'fixtures', 'thumbnails', 'master-lossless-image.png'))
		await upload('/Home/fixture-masters/master-lossless-image.png', masterImage)
		await uploadFixture('/Home/fixture-masters/master-lossless-video.mkv', 'master-lossless-video.mkv')
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	async function upload(path: string, content: string | Buffer = path) {
		await umbreld.api.post(`files/upload?path=${encodeURIComponent(path)}`, {body: content})
	}

	async function uploadFixture(path: string, name: string) {
		await upload(path, await fse.readFile(nodePath.resolve(__dirname, 'fixtures', 'thumbnails', name)))
	}

	function thumbnailIdentity(url: string) {
		const filename = nodePath.basename(new URL(url, 'http://localhost').pathname)
		const match = new RegExp(`^(content|transient)-${variant}-([a-f0-9]{64})\\.webp$`, 'i').exec(filename)
		if (!match) throw new Error(`Unexpected thumbnail URL: ${url}`)
		return {kind: match[1].toLowerCase(), key: match[2].toLowerCase()}
	}

	function thumbnailHash(url: string) {
		return thumbnailIdentity(url).key
	}

	function thumbnailSystemPath(url: string) {
		const {kind, key} = thumbnailIdentity(url)
		return `${guestThumbnailRoot}/${kind}/${variant}/${key.slice(0, 2)}/${key}.webp`
	}

	async function assetExists(url: string) {
		return (await umbreld.vm.sshAsRoot(`test -f '${thumbnailSystemPath(url)}' && echo yes || echo no`)) === 'yes'
	}

	async function permanentlyDelete(path: string) {
		const trashPath = await umbreld.client.files.trash.mutate({path})
		await expect(umbreld.client.files.delete.mutate({path: trashPath})).resolves.toBe(true)
	}

	async function waitForDirectoryThumbnails(path: string, count: number, timeoutMs = 180_000) {
		let files!: Awaited<ReturnType<typeof umbreld.client.files.list.query>>['files']
		await pRetry(
			async () => {
				files = (await umbreld.client.files.list.query({path, limit: Math.min(count, 250)})).files
				expect(files).toHaveLength(count)
				expect(files.every((file) => typeof file.thumbnail === 'string')).toBe(true)
			},
			{retries: Math.ceil(timeoutMs / 250), factor: 1, minTimeout: 250, maxTimeout: 250},
		)
		return files
	}

	test('generates and serves a sharded content-addressed thumbnail on demand', async () => {
		const path = `${suiteRoot}/on-demand.png`
		await upload(path, Buffer.concat([masterImage, Buffer.from('on-demand')]))

		await expect(umbreld.unauthenticatedClient.files.getThumbnail.mutate({path})).rejects.toThrow('Invalid token')
		const url = await umbreld.client.files.getThumbnail.mutate({path})
		expect(url).toMatch(thumbnailUrlPattern)
		expect(new URL(url, 'http://localhost').searchParams.get('path')).toBe(path)
		await expect(assetExists(url)).resolves.toBe(true)

		const response = await umbreld.api.get(url.replace(/^\/api\//, ''), {responseType: 'buffer'})
		expect(response.statusCode).toBe(200)
		expect(response.headers['content-type']).toBe('image/webp')
		expect(response.body.length).toBeGreaterThan(0)
	})

	test('uses a direct filesystem identity without content hashing for transient roots', async () => {
		const path = '/External/transient-thumbnail-vm/photo.png'
		const guestPath = '/home/umbrel/umbrel/external/transient-thumbnail-vm/photo.png'
		await umbreld.vm.sshAsRoot(
			`mkdir -p '${nodePath.dirname(guestPath)}' && cp '${guestHome}/fixture-masters/master-lossless-image.png' '${guestPath}'`,
		)

		const firstUrl = await umbreld.client.files.getThumbnail.mutate({path})
		expect(thumbnailIdentity(firstUrl).kind).toBe('transient')
		await expect(assetExists(firstUrl)).resolves.toBe(true)
		const indexedIdentity = await umbreld.vm.sshAsRoot(`
			cd /opt/umbreld
			node -e '
				const Database = require("better-sqlite3")
				const database = new Database("/home/umbrel/umbrel/file-index/index.db", {readonly: true})
				const row = database.prepare("SELECT entries.thumbnail_identity_kind AS kind, entries.content_id, transient_thumbnail_variants.artifact_key AS key, transient_thumbnail_variants.state FROM entries JOIN index_roots ON index_roots.id = entries.root_id JOIN transient_thumbnail_variants ON transient_thumbnail_variants.entry_id = entries.id WHERE index_roots.virtual_path = ? AND entries.relative_path = ?").get("/External", "transient-thumbnail-vm/photo.png")
				process.stdout.write(JSON.stringify(row))
			'
		`)
		expect(JSON.parse(indexedIdentity)).toStrictEqual({
			kind: 'transient',
			content_id: null,
			key: thumbnailHash(firstUrl),
			state: 'ready',
		})

		await umbreld.vm.sshAsRoot(`touch -m -d '+2 seconds' '${guestPath}'`)
		const changedUrl = await umbreld.client.files.getThumbnail.mutate({path})
		expect(thumbnailIdentity(changedUrl).kind).toBe('transient')
		expect(thumbnailHash(changedUrl)).not.toBe(thumbnailHash(firstUrl))
		await expect(assetExists(changedUrl)).resolves.toBe(true)
		await pRetry(async () => expect(await assetExists(firstUrl)).toBe(false), {
			retries: 240,
			factor: 1,
			minTimeout: 250,
			maxTimeout: 250,
		})
	})

	const imageTypes = [
		{extension: 'png'},
		{extension: 'jpg'},
		{extension: 'jpeg'},
		{extension: 'jfif', outputCoder: 'JPEG'},
		{extension: 'jpe', outputCoder: 'JPEG'},
		{extension: 'gif'},
		{extension: 'webp'},
		{extension: 'avif'},
		{extension: 'heic'},
		{extension: 'heif'},
		{extension: 'tif'},
		{extension: 'tiff'},
		{extension: 'bmp'},
	]
	for (const {extension, outputCoder} of imageTypes) {
		test(`generates a real ${extension.toUpperCase()} thumbnail`, async () => {
			const guestPath = `${guestSuiteRoot}/formats/image.${extension}`
			const output = outputCoder ? `${outputCoder}:${guestPath}` : guestPath
			const converted = await umbreld.vm.sshAsRoot(
				`mkdir -p '${guestSuiteRoot}/formats' && convert '${guestHome}/fixture-masters/master-lossless-image.png' '${output}' && echo yes`,
			)
			expect(converted).toBe('yes')
			const url = await umbreld.client.files.getThumbnail.mutate({path: `${suiteRoot}/formats/image.${extension}`})
			await expect(assetExists(url)).resolves.toBe(true)
		})
	}

	test('ships the LibRaw camera decoders used by enrichment', async () => {
		const available = await umbreld.vm.sshAsRoot(`
			formats='ARW CR2 CR3 DNG NEF ORF RAF RW2'
			for format in $formats; do
				convert -list format | grep -Eq "^[[:space:]]*$format[[:space:]]+DNG[[:space:]]+r--.*\\([0-9.]+-Release\\)" || exit 1
			done
			echo yes
		`)
		expect(available).toBe('yes')
	})

	test('ships the HEVC decoder with initialized HDR image planes', async () => {
		// The plane initialization fix landed in 1.1.1, trixie ships 1.0.15
		const hasFix = await umbreld.vm.ssh(
			`dpkg --compare-versions "$(dpkg-query -W -f='\${Version}' libde265-0)" ge 1.1.1-1 && printf yes`,
		)
		expect(hasFix).toBe('yes')
	})

	test('generates a genuine Apple HEIC thumbnail', async () => {
		const path = `${suiteRoot}/formats/apple.heic`
		await uploadFixture(path, 'apple-encoded-image.heic')
		const url = await umbreld.client.files.getThumbnail.mutate({path})
		await expect(assetExists(url)).resolves.toBe(true)
	})

	test('preserves aspect ratio while scaling the short side to 192px', async () => {
		const path = `${suiteRoot}/formats/landscape.png`
		const encoded = await umbreld.vm.sshAsRoot('convert -size 300x200 xc:red png:- | base64 -w 0')
		await upload(path, Buffer.from(encoded, 'base64'))

		const url = await umbreld.client.files.getThumbnail.mutate({path})
		const dimensions = await umbreld.vm.sshAsRoot(`identify -quiet -format '%wx%h' '${thumbnailSystemPath(url)}[0]'`)
		expect(dimensions).toBe('288x192')
	})

	test('treats ImageMagick wildcard syntax in filenames literally', async () => {
		const directory = `${suiteRoot}/literal-filenames`
		const guestDirectory = `${guestSuiteRoot}/literal-filenames`
		await umbreld.vm.sshAsRoot(`
			mkdir -p '${guestDirectory}'
			convert -size 20x20 xc:red '${guestDirectory}/source.png'
			convert -size 20x20 xc:blue '${guestDirectory}/photo1.png'
			cp '${guestDirectory}/photo1.png' '${guestDirectory}/photo0.png'
			cp '${guestDirectory}/source.png' '${guestDirectory}/photo[1].png'
			cp '${guestDirectory}/source.png' '${guestDirectory}/photo\\%d.png'
			cp '${guestDirectory}/source.png' '${guestDirectory}/photo\\name.png'
		`)

		for (const name of ['photo[1].png', String.raw`photo\%d.png`, String.raw`photo\name.png`]) {
			const url = await umbreld.client.files.getThumbnail.mutate({path: `${directory}/${name}`})
			const isRed = await umbreld.vm.sshAsRoot(
				`convert '${thumbnailSystemPath(url)}' -format '%[fx:mean.r>mean.b]' info:`,
			)
			expect(isRed).toBe('1')
		}
	})

	const videoTypes = [
		{extension: 'mkv', encode: '-c:v libx264'},
		{extension: 'mov', encode: '-c:v libx264'},
		{extension: 'mp4', encode: '-c:v libx264'},
		{extension: '3gp', encode: '-c:v libx264'},
		{extension: 'avi', encode: '-c:v libx264'},
		{extension: '3g2', encode: '-c:v libx264 -f 3g2'},
		{extension: 'mts', encode: '-c:v mpeg2video -f mpegts'},
		{extension: 'm2ts', encode: '-c:v mpeg2video -f mpegts'},
		{extension: 'mpg', encode: '-c:v mpeg2video -f mpeg'},
		{extension: 'mpeg', encode: '-c:v mpeg2video -f mpeg'},
		{extension: 'wmv', encode: '-c:v wmv2 -f asf'},
		{extension: '360', encode: '-c:v libx264 -f mp4'},
		{extension: 'insv', encode: '-c:v libx264 -f mp4'},
	]
	for (const {extension, encode} of videoTypes) {
		test(`generates a real ${extension.toUpperCase()} video thumbnail`, async () => {
			const guestPath = `${guestSuiteRoot}/formats/video.${extension}`
			const converted = await umbreld.vm.sshAsRoot(
				`mkdir -p '${guestSuiteRoot}/formats' && ffmpeg -loglevel error -y -i '${guestHome}/fixture-masters/master-lossless-video.mkv' ${encode} '${guestPath}' && echo yes`,
			)
			expect(converted).toBe('yes')
			const url = await umbreld.client.files.getThumbnail.mutate({path: `${suiteRoot}/formats/video.${extension}`})
			await expect(assetExists(url)).resolves.toBe(true)
		})
	}

	test('deduplicates identical files and retains the asset until the final reference is deleted', async () => {
		const content = Buffer.concat([masterImage, Buffer.from('dedupe-only')])
		const first = `${suiteRoot}/dedupe/first.png`
		const second = `${suiteRoot}/dedupe/second.png`
		await Promise.all([upload(first, content), upload(second, content)])

		const [firstUrl, secondUrl] = await Promise.all([
			umbreld.client.files.getThumbnail.mutate({path: first}),
			umbreld.client.files.getThumbnail.mutate({path: second}),
		])
		expect(thumbnailHash(secondUrl)).toBe(thumbnailHash(firstUrl))

		await permanentlyDelete(first)
		await expect(assetExists(secondUrl)).resolves.toBe(true)
		await expect(umbreld.api.get(secondUrl.replace(/^\/api\//, ''), {responseType: 'buffer'})).resolves.toMatchObject({
			statusCode: 200,
		})

		await permanentlyDelete(second)
		await pRetry(async () => expect(await assetExists(secondUrl)).toBe(false), {
			retries: 240,
			factor: 1,
			minTimeout: 250,
			maxTimeout: 250,
		})
	})

	test('keeps content-addressed thumbnail identity across rename and move', async () => {
		const original = `${suiteRoot}/identity/source/original.png`
		const renamed = `${suiteRoot}/identity/source/renamed.png`
		const moved = `${suiteRoot}/identity/destination/renamed.png`
		await umbreld.client.files.createDirectory.mutate({path: `${suiteRoot}/identity`})
		await umbreld.client.files.createDirectory.mutate({path: `${suiteRoot}/identity/source`})
		await umbreld.client.files.createDirectory.mutate({path: `${suiteRoot}/identity/destination`})
		await upload(original, Buffer.concat([masterImage, Buffer.from('identity')]))

		const originalUrl = await umbreld.client.files.getThumbnail.mutate({path: original})
		await umbreld.client.files.rename.mutate({path: original, newName: 'renamed.png'})
		const renamedUrl = await umbreld.client.files.getThumbnail.mutate({path: renamed})
		await umbreld.client.files.move.mutate({path: renamed, toDirectory: `${suiteRoot}/identity/destination`})
		const movedUrl = await umbreld.client.files.getThumbnail.mutate({path: moved})

		expect(thumbnailHash(renamedUrl)).toBe(thumbnailHash(originalUrl))
		expect(thumbnailHash(movedUrl)).toBe(thumbnailHash(originalUrl))
		await expect(assetExists(movedUrl)).resolves.toBe(true)
	})

	test('rehashes changed metadata while preserving content identity', async () => {
		const path = `${suiteRoot}/revision.png`
		const guestPath = `${guestSuiteRoot}/revision.png`
		await upload(path, Buffer.concat([masterImage, Buffer.from('revision-a')]))
		const firstUrl = await umbreld.client.files.getThumbnail.mutate({path})

		// A changed mtime invalidates the cached fingerprint and causes a rehash,
		// but content addressing resolves back to the same hash and usable artifact.
		// The artifact may be recreated if concurrent garbage collection removes it
		// while the entry is temporarily unhashed, so its filesystem mtime is not a
		// stable part of the contract.
		await umbreld.vm.sshAsRoot(`touch -m -d '+2 seconds' '${guestPath}'`)
		const touchedUrl = await umbreld.client.files.getThumbnail.mutate({path})
		expect(thumbnailHash(touchedUrl)).toBe(thumbnailHash(firstUrl))
		await expect(assetExists(touchedUrl)).resolves.toBe(true)

		// Changing bytes creates a new content hash and artifact. The old artifact
		// becomes inferred garbage and is removed after the entry changes revision.
		await umbreld.vm.sshAsRoot(`printf revision-b >> '${guestPath}'`)
		const changedUrl = await umbreld.client.files.getThumbnail.mutate({path})
		expect(thumbnailHash(changedUrl)).not.toBe(thumbnailHash(firstUrl))
		await pRetry(async () => expect(await assetExists(firstUrl)).toBe(false), {
			retries: 240,
			factor: 1,
			minTimeout: 250,
			maxTimeout: 250,
		})
	})

	test('background enrichment supplies list and recents without an on-demand request', async () => {
		const path = `${suiteRoot}/background/recent.png`
		await upload(path, Buffer.concat([masterImage, Buffer.from('background-list')]))
		const [file] = await waitForDirectoryThumbnails(`${suiteRoot}/background`, 1)
		expect(file.path).toBe(path)

		await pRetry(
			async () => {
				const recent = (await umbreld.client.files.recents.query()).find((entry) => entry.path === path)
				expect(recent?.thumbnail).toBe(file.thumbnail)
			},
			{retries: 120, factor: 1, minTimeout: 250, maxTimeout: 250},
		)
	})

	test('repairs a missing physical asset after a normal file listing observes it', async () => {
		const path = `${suiteRoot}/repair/missing.png`
		await upload(path, Buffer.concat([masterImage, Buffer.from('missing-physical-asset')]))
		const url = await umbreld.client.files.getThumbnail.mutate({path})
		await umbreld.vm.sshAsRoot(`rm '${thumbnailSystemPath(url)}'`)

		const missing = await umbreld.client.files.list.query({path: `${suiteRoot}/repair`})
		expect(missing.files[0].thumbnail).toBeUndefined()
		const [repaired] = await waitForDirectoryThumbnails(`${suiteRoot}/repair`, 1)
		expect(thumbnailHash(repaired.thumbnail!)).toBe(thumbnailHash(url))
		await expect(assetExists(url)).resolves.toBe(true)
	})

	test('rejects directories and unsupported files without creating derived content', async () => {
		const directory = `${suiteRoot}/unsupported`
		const text = `${directory}/notes.txt`
		await umbreld.client.files.createDirectory.mutate({path: directory})
		await upload(text, 'plain text')

		await expect(umbreld.client.files.getThumbnail.mutate({path: directory})).rejects.toThrow(
			'Unsupported or missing thumbnail source',
		)
		await expect(umbreld.client.files.getThumbnail.mutate({path: text})).rejects.toThrow(
			'Unsupported or missing thumbnail source',
		)
		const listing = await umbreld.client.files.list.query({path: directory})
		expect(listing.files[0].thumbnail).toBeUndefined()
	})

	test('converges a large out-of-band event burst while background generation remains responsive', async () => {
		const count = 160
		const path = `${suiteRoot}/churn`
		const guestPath = `${guestSuiteRoot}/churn`
		await umbreld.vm.sshAsRoot(`
			mkdir -p '${guestPath}'
			for i in $(seq -w 1 ${count}); do
				cp '${guestHome}/fixture-masters/master-lossless-image.png' '${guestPath}/image-'$i'.png'
				printf 'initial-%s' "$i" >> '${guestPath}/image-'$i'.png'
			done
			for n in $(seq 1 40); do i=$(printf '%03d' "$n"); mv '${guestPath}/image-'$i'.png' '${guestPath}/renamed-'$i'.png'; done
			for n in $(seq 41 80); do i=$(printf '%03d' "$n"); rm '${guestPath}/image-'$i'.png'; done
			for n in $(seq 81 120); do i=$(printf '%03d' "$n"); printf 'changed-%s' "$i" >> '${guestPath}/image-'$i'.png'; done
			for i in $(seq -w 161 200); do
				cp '${guestHome}/fixture-masters/master-lossless-image.png' '${guestPath}/new-'$i'.png'
				printf 'new-%s' "$i" >> '${guestPath}/new-'$i'.png'
			done
		`)

		const probeStartedAt = Date.now()
		await expect(umbreld.unauthenticatedClient.user.exists.query()).resolves.toBe(true)
		expect(Date.now() - probeStartedAt).toBeLessThan(2000)

		const files = await waitForDirectoryThumbnails(path, count, 600_000)
		expect(new Set(files.map((file) => thumbnailHash(file.thumbnail!))).size).toBe(count)
		expect(files.some((file) => file.name === 'renamed-001.png')).toBe(true)
		expect(files.some((file) => file.name === 'image-041.png')).toBe(false)
		expect(files.some((file) => file.name === 'new-200.png')).toBe(true)
	})

	test('resumes a durable thumbnail backlog after a service restart and hard power cut', async () => {
		const count = 60
		const path = `${suiteRoot}/restart-backlog`
		const guestPath = `${guestSuiteRoot}/restart-backlog`
		await umbreld.vm.sshAsRoot('systemctl stop umbrel')
		await umbreld.vm.sshAsRoot(`
			mkdir -p '${guestPath}'
			for i in $(seq -w 1 ${count}); do
				cp '${guestHome}/fixture-masters/master-lossless-image.png' '${guestPath}/restart-'$i'.png'
				printf 'restart-%s' "$i" >> '${guestPath}/restart-'$i'.png'
			done
			# These files are the durable input to the recovery test. Persist them
			# before starting enrichment so the later power cut targets only the
			# in-flight index and derived-artifact work, not unsynced fixture writes.
			sync -f '${guestPath}'
			systemctl start umbrel
		`)

		// Prove this is a real mid-backlog power cut, not a restart after all work
		// happened to finish. Poll through umbreld's production better-sqlite3
		// dependency inside the guest (the production image has no sqlite3 CLI), so
		// SSH latency cannot skip the partial window. Every ready row must already
		// have a non-empty published artifact before power is removed.
		const partialState = await umbreld.vm.sshAsRoot(`
			cd /opt/umbreld
			node -e '
				const Database = require("better-sqlite3")
				const fs = require("node:fs")
				const database = new Database("/home/umbrel/umbrel/file-index/index.db", {readonly: true})
				const stateQuery = database.prepare("SELECT COUNT(*) AS indexed, COALESCE(SUM(entries.content_id IS NOT NULL), 0) AS hashed, COALESCE(SUM(CASE WHEN thumbnail_variants.state = ? THEN 1 ELSE 0 END), 0) AS ready FROM entries JOIN index_roots ON index_roots.id = entries.root_id LEFT JOIN thumbnail_variants ON thumbnail_variants.content_id = entries.content_id AND thumbnail_variants.variant = ? WHERE index_roots.virtual_path = ? AND entries.relative_path LIKE ?")
				const hashQuery = database.prepare("SELECT lower(hex(contents.blake3)) AS hash FROM entries JOIN index_roots ON index_roots.id = entries.root_id JOIN contents ON contents.id = entries.content_id JOIN thumbnail_variants ON thumbnail_variants.content_id = entries.content_id AND thumbnail_variants.variant = ? AND thumbnail_variants.state = ? WHERE index_roots.virtual_path = ? AND entries.relative_path LIKE ?")
				const sleep = new Int32Array(new SharedArrayBuffer(4))
				for (let attempt = 0; attempt < 6000; attempt++) {
					const state = stateQuery.get("ready", "${variant}", "/Home", "thumbnail-index-vm/restart-backlog/%")
					if (state.indexed === ${count} && state.ready > 0 && state.ready < ${count}) {
						const artifactsReady = hashQuery.all("${variant}", "ready", "/Home", "thumbnail-index-vm/restart-backlog/%").every(({hash}) => {
							const path = "${guestThumbnailRoot}/content/${variant}/" + hash.slice(0, 2) + "/" + hash + ".webp"
							try { return fs.statSync(path).size > 0 } catch { return false }
						})
						if (artifactsReady) {
							process.stdout.write([state.indexed, state.hashed, state.ready].join("|"))
							database.close()
							process.exit(0)
						}
					}
					Atomics.wait(sleep, 0, 0, 10)
				}
				database.close()
				process.exit(1)
			'
		`)
		const [indexed, hashed, ready] = partialState.split('|').map(Number)
		console.info(`Cutting VM power with thumbnail backlog at indexed=${indexed}, hashed=${hashed}, ready=${ready}`)
		expect(indexed).toBe(count)
		expect(hashed).toBeGreaterThanOrEqual(ready)
		expect(ready).toBeGreaterThan(0)
		expect(ready).toBeLessThan(count)

		// The DB is durable and temporary output is never published as ready.
		await umbreld.vm.forcePowerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()

		// Wait on the durable invariant inside the guest before asking the Files UI
		// to render every thumbnail. Polling the directory listing four times per
		// second creates thousands of high-priority cross-worker reads on slower CI
		// runners and can itself delay the low-priority recovery being measured.
		// On failure, report the final DB/artifact state instead of timing out with
		// no indication of which part did not converge.
		let recoveredState: string
		try {
			recoveredState = await umbreld.vm.sshAsRoot(`
				cd /opt/umbreld
				node -e '
				const Database = require("better-sqlite3")
				const fs = require("node:fs")
				const database = new Database("/home/umbrel/umbrel/file-index/index.db", {readonly: true})
				const stateQuery = database.prepare("SELECT COUNT(*) AS indexed, COALESCE(SUM(entries.content_id IS NOT NULL), 0) AS hashed, COALESCE(SUM(CASE WHEN thumbnail_variants.state = ? THEN 1 ELSE 0 END), 0) AS ready FROM entries JOIN index_roots ON index_roots.id = entries.root_id LEFT JOIN thumbnail_variants ON thumbnail_variants.content_id = entries.content_id AND thumbnail_variants.variant = ? WHERE index_roots.virtual_path = ? AND entries.relative_path LIKE ?")
				const hashQuery = database.prepare("SELECT lower(hex(contents.blake3)) AS hash FROM entries JOIN index_roots ON index_roots.id = entries.root_id JOIN contents ON contents.id = entries.content_id JOIN thumbnail_variants ON thumbnail_variants.content_id = entries.content_id AND thumbnail_variants.variant = ? AND thumbnail_variants.state = ? WHERE index_roots.virtual_path = ? AND entries.relative_path LIKE ?")
				const sleep = new Int32Array(new SharedArrayBuffer(4))
				let lastState
				let usableArtifacts = 0
				for (let attempt = 0; attempt < 18000; attempt++) {
					lastState = stateQuery.get("ready", "${variant}", "/Home", "thumbnail-index-vm/restart-backlog/%")
					if (lastState.indexed === ${count} && lastState.hashed === ${count} && lastState.ready === ${count}) {
						const hashes = hashQuery.all("${variant}", "ready", "/Home", "thumbnail-index-vm/restart-backlog/%")
						usableArtifacts = hashes.filter(({hash}) => {
							const path = "${guestThumbnailRoot}/content/${variant}/" + hash.slice(0, 2) + "/" + hash + ".webp"
							try { return fs.statSync(path).size > 0 } catch { return false }
						}).length
						if (usableArtifacts === ${count}) {
							process.stdout.write([lastState.indexed, lastState.hashed, lastState.ready, usableArtifacts].join("|"))
							database.close()
							process.exit(0)
						}
					}
					Atomics.wait(sleep, 0, 0, 10)
				}
				const targetVariants = database.prepare("SELECT COALESCE(thumbnail_variants.state, ? ) AS state, COUNT(*) AS count FROM entries JOIN index_roots ON index_roots.id = entries.root_id LEFT JOIN thumbnail_variants ON thumbnail_variants.content_id = entries.content_id AND thumbnail_variants.variant = ? WHERE index_roots.virtual_path = ? AND entries.relative_path LIKE ? GROUP BY thumbnail_variants.state").all("missing", "${variant}", "/Home", "thumbnail-index-vm/restart-backlog/%")
				const allVariants = database.prepare("SELECT state, COUNT(*) AS count FROM thumbnail_variants WHERE variant = ? GROUP BY state").all("${variant}")
				const roots = database.prepare("SELECT virtual_path, state, scan_generation, last_error FROM index_roots ORDER BY virtual_path").all()
				const pendingSample = database.prepare("SELECT entries.relative_path, thumbnail_variants.content_id, thumbnail_variants.state, thumbnail_variants.failure_count, thumbnail_variants.retry_at, thumbnail_variants.last_error FROM entries JOIN index_roots ON index_roots.id = entries.root_id LEFT JOIN thumbnail_variants ON thumbnail_variants.content_id = entries.content_id AND thumbnail_variants.variant = ? WHERE index_roots.virtual_path = ? AND entries.relative_path LIKE ? ORDER BY entries.id LIMIT 5").all("${variant}", "/Home", "thumbnail-index-vm/restart-backlog/%")
				console.error("recovery-state=" + JSON.stringify({...lastState, usableArtifacts, targetVariants, allVariants, roots, pendingSample}))
				database.close()
				process.exit(1)
			'
			`)
		} catch (error) {
			const journal = await umbreld.vm.sshAsRoot(
				`journalctl -u umbrel --since '-5 minutes' --no-pager | tail -200 || true`,
			)
			throw new Error(`${String(error)}\numbrel-journal:\n${journal}`, {cause: error})
		}
		expect(recoveredState).toBe(`${count}|${count}|${count}|${count}`)

		const files = await waitForDirectoryThumbnails(path, count, 30_000)
		expect(new Set(files.map((file) => thumbnailHash(file.thumbnail!))).size).toBe(count)

		const errors = await umbreld.vm.sshAsRoot(
			`journalctl -u umbrel --since '-15 minutes' --no-pager | grep -E 'Unhandled|uncaught|File enrichment background step failed' || true`,
		)
		expect(errors).toBe('')
	})
})
