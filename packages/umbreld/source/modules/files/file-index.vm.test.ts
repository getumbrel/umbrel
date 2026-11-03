import {afterAll, beforeAll, describe, expect, test} from 'vitest'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

let umbreld: Awaited<ReturnType<typeof createTestVm>>

const suiteRoot = '/Home/file-index-vm'

beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
	await umbreld.client.files.createDirectory.mutate({path: suiteRoot})

	// Wait for the real initial index pass so the tests below exercise the
	// durable searchable index as well as direct mutation updates.
	await pRetry(
		() => umbreld.vm.sshAsRoot(`journalctl -u umbrel --no-pager | grep -F "Reconciled '/Home'" >/dev/null`),
		{retries: 120, factor: 1, minTimeout: 500, maxTimeout: 500},
	)
})

afterAll(async () => {
	await umbreld.cleanup()
})

async function upload(path: string, content = path) {
	await umbreld.api.post(`files/upload?path=${encodeURIComponent(path)}`, {body: content})
}

async function searchPaths(query: string) {
	return (await umbreld.client.files.search.query({query, maxResults: 1000})).map(({path}) => path)
}

async function expectEventually(path: string, present: boolean) {
	const name = path.split('/').at(-1)!
	await pRetry(
		async () => {
			const paths = await searchPaths(name)
			expect(paths.includes(path)).toBe(present)
		},
		{retries: 120, factor: 1, minTimeout: 250, maxTimeout: 250},
	)
}

describe('durable file index', () => {
	test('stores derived state outside watched roots and converges direct mutation hints', async () => {
		await expect(umbreld.vm.sshAsRoot(`test -f '${umbreld.vm.dataDirectory}/file-index/index.db'`)).resolves.toBe('')
		await expect(umbreld.vm.sshAsRoot(`test -f '${umbreld.vm.dataDirectory}/umbrel.db'`)).resolves.toBe('')
		await expect(
			umbreld.vm.sshAsRoot(`test ! -e '${umbreld.vm.dataDirectory}/file-index/index.sqlite3'`),
		).resolves.toBe('')
		await expect(umbreld.vm.sshAsRoot(`test ! -e '${umbreld.vm.dataDirectory}/photos/photos.sqlite3'`)).resolves.toBe(
			'',
		)

		const original = `${suiteRoot}/direct-original-7d53f0.txt`
		const renamed = `${suiteRoot}/direct-renamed-7d53f0.txt`
		await upload(original)
		await expectEventually(original, true)

		await expect(
			umbreld.client.files.rename.mutate({path: original, newName: 'direct-renamed-7d53f0.txt'}),
		).resolves.toBe(renamed)
		await expectEventually(original, false)
		await expectEventually(renamed, true)

		const trashed = await umbreld.client.files.trash.mutate({path: renamed})
		await expectEventually(renamed, false)
		await expect(umbreld.client.files.restore.mutate({path: trashed, collision: 'error'})).resolves.toBe(renamed)
		await expectEventually(renamed, true)

		const reTrashed = await umbreld.client.files.trash.mutate({path: renamed})
		await expect(umbreld.client.files.delete.mutate({path: reTrashed})).resolves.toBe(true)
		await expectEventually(renamed, false)
	})

	test('converges a burst of out-of-band creates, renames, and deletes', async () => {
		const systemRoot = `${umbreld.vm.dataDirectory}/home/file-index-vm/watch-burst`
		await umbreld.vm.sshAsRoot(`
			mkdir -p '${systemRoot}'
			for i in $(seq -w 1 500); do printf '%s' "$i" > '${systemRoot}/watch-burst-'"$i"'-91a6.txt'; done
			mv '${systemRoot}/watch-burst-500-91a6.txt' '${systemRoot}/watch-renamed-500-91a6.txt'
			rm '${systemRoot}/watch-burst-250-91a6.txt'
		`)

		await expectEventually(`${suiteRoot}/watch-burst/watch-burst-001-91a6.txt`, true)
		await expectEventually(`${suiteRoot}/watch-burst/watch-renamed-500-91a6.txt`, true)
		await expectEventually(`${suiteRoot}/watch-burst/watch-burst-250-91a6.txt`, false)
		await expectEventually(`${suiteRoot}/watch-burst/watch-burst-500-91a6.txt`, false)
	})

	test('keeps umbreld responsive while the worker performs repeated full-index searches', async () => {
		const systemRoot = `${umbreld.vm.dataDirectory}/home/file-index-vm/worker-load`
		await umbreld.vm.sshAsRoot(`
			mkdir -p '${systemRoot}'
			for i in $(seq -w 1 20000); do : > '${systemRoot}/worker-load-'$i'-5f31.txt'; done
		`)
		await expectEventually(`${suiteRoot}/worker-load/worker-load-20000-5f31.txt`, true)

		let searchesSettled = false
		const searches = Promise.all(
			Array.from({length: 16}, () =>
				umbreld.client.files.search.query({query: 'worker-load-probe-5f31', maxResults: 1}),
			),
		).finally(() => {
			searchesSettled = true
		})
		await new Promise((resolve) => setTimeout(resolve, 50))

		const probeStartedAt = Date.now()
		await expect(umbreld.unauthenticatedClient.user.exists.query()).resolves.toBe(true)
		expect(Date.now() - probeStartedAt).toBeLessThan(2000)
		expect(searchesSettled).toBe(false)
		await searches
	})

	test('indexes symlinks without traversing them and excludes hidden temporary files', async () => {
		const homeSystemRoot = `${umbreld.vm.dataDirectory}/home/file-index-vm`
		const outsideRoot = '/home/umbrel/file-index-vm-outside'
		await umbreld.vm.sshAsRoot(`
			mkdir -p '${homeSystemRoot}/symlink-target-4c82'
			printf visible > '${homeSystemRoot}/symlink-target-4c82/target-secret-4c82.txt'
			ln -s '${homeSystemRoot}/symlink-target-4c82' '${homeSystemRoot}/directory-link-4c82'
			mkdir -p '${outsideRoot}'
			printf secret > '${outsideRoot}/outside-secret-4c82.txt'
			ln -s '${outsideRoot}' '${homeSystemRoot}/outside-link-4c82'
			printf partial > '${homeSystemRoot}/.partial-4c82.txt.umbrel-upload'
		`)

		await expectEventually(`${suiteRoot}/directory-link-4c82`, true)
		await expectEventually(`${suiteRoot}/directory-link-4c82/target-secret-4c82.txt`, false)
		await expectEventually(`${suiteRoot}/symlink-target-4c82/target-secret-4c82.txt`, true)
		await expectEventually(`${suiteRoot}/outside-link-4c82`, false)
		expect(await searchPaths('partial-4c82')).not.toContain(`${suiteRoot}/.partial-4c82.txt.umbrel-upload`)
	})

	test('repairs missed events after service downtime and survives a hard power cut', async () => {
		const removedWhileStopped = `${suiteRoot}/removed-while-stopped-c193.txt`
		const createdWhileStopped = `${suiteRoot}/created-while-stopped-c193.txt`
		await upload(removedWhileStopped)
		await expectEventually(removedWhileStopped, true)

		await umbreld.vm.sshAsRoot('systemctl stop umbrel')
		await umbreld.vm.sshAsRoot(`
			rm '${umbreld.vm.dataDirectory}/home/file-index-vm/removed-while-stopped-c193.txt'
			printf offline > '${umbreld.vm.dataDirectory}/home/file-index-vm/created-while-stopped-c193.txt'
		`)
		await umbreld.vm.sshAsRoot('systemctl start umbrel')
		await umbreld.waitForStartup({waitForUser: true})
		await umbreld.login()
		await expectEventually(removedWhileStopped, false)
		await expectEventually(createdWhileStopped, true)

		await umbreld.vm.forcePowerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()
		await expectEventually(createdWhileStopped, true)
	})
})
