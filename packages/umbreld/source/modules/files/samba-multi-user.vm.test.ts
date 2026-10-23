import type {Socket} from 'node:net'
import {setTimeout as delay} from 'node:timers/promises'
import {default as SMB2} from '@tryjsky/v9u-smb2'
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

const ownerDashboardPassword = 'moneyprintergobrrr'
const memberDashboardPassword = 'member-password'
const ownerSambaPassword = 'owner-samba-password'
const sambaDenialCodes = new Set(['STATUS_ACCESS_DENIED', 'STATUS_LOGON_FAILURE', 'STATUS_BAD_NETWORK_NAME'])

// Samba answers an async request that doesn't complete within 0.5ms (e.g. a
// read on a loaded guest right after boot) with an interim STATUS_PENDING
// response, then sends the final response under the same message id. v9u-smb2
// resolves the request with the interim response and fails it, so drop interim
// responses before they reach its parser and let it wait for the final one.
const SMB2_STATUS_PENDING = 0x00000103
const SMB2_FLAGS_ASYNC_COMMAND = 0x00000002
function dropInterimSmbResponses(socket: Socket) {
	const [handleFrames] = socket.listeners('data') as Array<(data: Buffer) => void>
	socket.removeListener('data', handleFrames)
	let buffered = Buffer.alloc(0)
	socket.on('data', (data: Buffer) => {
		buffered = Buffer.concat([buffered, data])
		// Each NetBIOS frame is a 4 byte header with a 24 bit length, followed by
		// the SMB2 header with Status at offset 8 and Flags at offset 16.
		while (buffered.length >= 4) {
			const frameLength = 4 + buffered.readUIntBE(1, 3)
			if (buffered.length < frameLength) return
			const frame = buffered.subarray(0, frameLength)
			buffered = buffered.subarray(frameLength)
			const isInterim =
				frame.length >= 24 &&
				frame.readUInt32LE(12) === SMB2_STATUS_PENDING &&
				(frame.readUInt32LE(20) & SMB2_FLAGS_ASYNC_COMMAND) !== 0
			if (!isInterim) handleFrames(frame)
		}
	})
}

describe.sequential('account-scoped Samba access', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let aliceId: string
	let bobId: string
	let aliceSambaUsername: string
	let bobSambaUsername: string
	let aliceSambaPassword: string
	let bobSambaPassword: string
	let aliceSystemUsername: string
	let bobSystemUsername: string
	let ownerSharename: string
	let aliceSharename: string
	let bobSharename: string

	const loginAs = async (userId: string, password: string) => {
		const token = await umbreld.client.user.login.mutate({userId, password})
		umbreld.setAuthToken(token)
	}

	const createSmbClient = (username: string, password: string, share: string) => {
		const client = new (SMB2 as any)({
			share: `\\\\127.0.0.1\\${share}`,
			port: umbreld.vm.getHostPort(445),
			username,
			password,
			autoCloseTimeout: 0,
		})
		dropInterimSmbResponses(client.socket)
		return client
	}
	const disconnectSmbClient = (client: ReturnType<typeof createSmbClient>) => {
		// v9u-smb2's disconnect is a no-op when session setup succeeds but tree
		// connect fails. Destroy the underlying socket as well so expected denials
		// cannot leak partial sessions into later assertions.
		client.disconnect()
		client.socket.destroy()
	}
	const withSmbTimeout = async <T>(operation: Promise<T>, label: string, timeoutMs = 10_000) => {
		let timeout: NodeJS.Timeout
		try {
			return await Promise.race([
				operation,
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error(`[smb-timeout] ${label}`)), timeoutMs)
					timeout.unref()
				}),
			])
		} finally {
			clearTimeout(timeout!)
		}
	}

	const expectSmbDenied = async (username: string, password: string, share: string) => {
		const client = createSmbClient(username, password, share)
		try {
			let denied = false
			try {
				await withSmbTimeout(client.exists('private.txt'), `authenticate ${username} to ${share}`)
			} catch (error) {
				if ((error as Error).message.startsWith('[smb-timeout]')) throw error
				expect(sambaDenialCodes).toContain((error as NodeJS.ErrnoException).code)
				denied = true
			}
			expect(denied).toBe(true)
		} finally {
			disconnectSmbClient(client)
		}
	}

	const expectSmbReadable = async (
		username: string,
		password: string,
		share: string,
		file: string,
		contents: string,
	) => {
		let lastError: unknown
		for (let attempt = 1; attempt <= 3; attempt++) {
			const client = createSmbClient(username, password, share)
			try {
				const result = await withSmbTimeout(
					client.readFile(file, {encoding: 'utf8'}),
					`read ${share}/${file} as ${username} (attempt ${attempt})`,
				)
				expect(result).toBe(contents)
				return
			} catch (error) {
				lastError = error
			} finally {
				disconnectSmbClient(client)
			}
			if (attempt < 3) await delay(1000)
		}
		throw lastError
	}
	const writeSmbFile = async (username: string, password: string, share: string, file: string, contents: string) => {
		const client = createSmbClient(username, password, share)
		try {
			await withSmbTimeout(
				client.writeFile(file, contents, {encoding: 'utf8', flags: 'w'}),
				`write ${share}/${file} as ${username}`,
			)
		} finally {
			disconnectSmbClient(client)
		}
	}

	// umbreld answers RPCs before Files startup has applied credentials and
	// shares and started smbd, and until smbd listens the forwarded port resets
	// connections. smbd only starts after its config is written, so once it
	// listens the post-boot Samba state is ready to assert on.
	const waitForSmbd = async () =>
		expect(
			umbreld.vm.sshAsRoot(`
				for attempt in $(seq 1 1200); do
					if ss -Hltn 'sport = :445' | grep -q .; then echo listening; exit 0; fi
					sleep 0.1
				done
				echo timed-out
			`),
		).resolves.toContain('listening')
	const mappedSystemUsername = async (clientUsername: string) =>
		(await umbreld.vm.sshAsRoot(`awk -F ' = ' '$2 == "${clientUsername}" { print $1 }' /etc/samba/username.map`)).trim()
	const activeSmbProcessId = async (systemUsername: string) =>
		(
			await umbreld.vm.sshAsRoot(
				`export SMB_USER='${systemUsername}'
				for attempt in $(seq 1 100); do
					process_id=$(smbstatus -b | awk '$2 == ENVIRON["SMB_USER"] { print $1; exit }')
					if [ -n "$process_id" ]; then echo "$process_id"; exit 0; fi
					sleep 0.1
				done`,
			)
		).trim()
	const expectSmbProcessStopped = async (processId: string) => {
		expect(processId).toMatch(/^\d+$/)
		await expect(
			umbreld.vm.sshAsRoot(`
				for attempt in $(seq 1 100); do
					if ! kill -0 '${processId}' 2>/dev/null; then echo stopped; exit 0; fi
					sleep 0.1
				done
				echo running
			`),
		).resolves.toContain('stopped')
	}

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home', forwardPorts: [{guestPort: 445}]})
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

	test('owner rotates the main Samba password and creates a private share', async () => {
		const originalPassword = await umbreld.client.files.sharePassword.query()
		await umbreld.client.files.setSharePassword.mutate({password: ownerSambaPassword})
		expect(await umbreld.client.files.sharePassword.query()).toBe(ownerSambaPassword)
		await expect(
			umbreld.vm.sshAsRoot(`stat -c '%a' '${umbreld.vm.dataDirectory}/secrets/share-password'`),
		).resolves.toContain('600')

		await umbreld.client.files.createDirectory.mutate({path: '/Home/Owner private'})
		await umbreld.client.files.addShare.mutate({path: '/Home/Owner private'})
		ownerSharename = (await umbreld.client.files.shares.query()).find(
			(share) => share.path === '/Home/Owner private',
		)!.sharename

		await writeSmbFile('umbrel', ownerSambaPassword, ownerSharename, 'private.txt', 'owner data')
		await expectSmbReadable('umbrel', ownerSambaPassword, ownerSharename, 'private.txt', 'owner data')
		await expectSmbDenied('umbrel', originalPassword, ownerSharename)
	})

	test('owner enables separate Samba credentials for two members without seeing their passwords', async () => {
		// This deliberately produces member id `Umbrel`, which must not collide
		// case-insensitively with the owner's historic `umbrel` Samba username.
		const alice = await umbreld.client.user.createUser.mutate({name: 'Umbrel', password: memberDashboardPassword})
		const bob = await umbreld.client.user.createUser.mutate({name: 'Bob', password: memberDashboardPassword})
		aliceId = alice.userId
		bobId = bob.userId
		expect(aliceId).toBe('Umbrel')
		aliceSambaUsername = 'member-umbrel'
		bobSambaUsername = 'bob'

		await umbreld.client.files.setMemberSambaAccess.mutate({userId: aliceId, enabled: true})
		await umbreld.client.files.setMemberSambaAccess.mutate({userId: bobId, enabled: true})
		expect(await umbreld.client.files.memberSambaAccess.query()).toEqual([
			{userId: aliceId, enabled: true, username: aliceSambaUsername},
			{userId: bobId, enabled: true, username: bobSambaUsername},
		])

		aliceSystemUsername = await mappedSystemUsername(aliceSambaUsername)
		bobSystemUsername = await mappedSystemUsername(bobSambaUsername)
		expect(aliceSystemUsername).toMatch(/^umbrel-smb-[a-f0-9]{20}$/)
		expect(bobSystemUsername).toMatch(/^umbrel-smb-[a-f0-9]{20}$/)
		expect(bobSystemUsername).not.toBe(aliceSystemUsername)
		await expect(umbreld.vm.sshAsRoot(`getent passwd '${aliceSystemUsername}'`)).resolves.toContain('/usr/sbin/nologin')
		await expect(umbreld.vm.sshAsRoot(`getent passwd '${bobSystemUsername}'`)).resolves.toContain('/usr/sbin/nologin')
		await expect(umbreld.vm.sshAsRoot("stat -c '%a' /etc/samba/username.map")).resolves.toContain('600')
	})

	test('members can use Samba RPCs only for directories in their own Home', async () => {
		await loginAs(aliceId, memberDashboardPassword)
		const alice = await umbreld.client.user.get.query()
		expect(alice).toMatchObject({sambaEnabled: true, sambaUsername: aliceSambaUsername})
		aliceSambaPassword = await umbreld.client.files.sharePassword.query()
		expect(aliceSambaPassword).toMatch(/^[a-f0-9]{32}$/)

		await umbreld.client.files.createDirectory.mutate({path: `/Users/${aliceId}/Alice private`})
		await umbreld.client.files.addShare.mutate({path: `/Users/${aliceId}/Alice private`})
		aliceSharename = (await umbreld.client.files.shares.query()).find(
			(share) => share.path === `/Users/${aliceId}/Alice private`,
		)!.sharename
		await expect(umbreld.client.files.addShare.mutate({path: '/Home/Owner private'})).rejects.toThrow(
			'[operation-not-allowed]',
		)
		await expect(umbreld.client.files.addShare.mutate({path: `/Users/${bobId}`})).rejects.toThrow(
			'[operation-not-allowed]',
		)
		await expect(umbreld.client.files.addShare.mutate({path: `/Users/${aliceId}/Trash`})).rejects.toThrow(
			'[operation-not-allowed]',
		)

		await writeSmbFile(aliceSambaUsername, aliceSambaPassword, aliceSharename, 'private.txt', 'alice data')

		await loginAs(bobId, memberDashboardPassword)
		bobSambaPassword = await umbreld.client.files.sharePassword.query()
		await umbreld.client.files.createDirectory.mutate({path: `/Users/${bobId}/Bob private`})
		await umbreld.client.files.addShare.mutate({path: `/Users/${bobId}/Bob private`})
		bobSharename = (await umbreld.client.files.shares.query()).find(
			(share) => share.path === `/Users/${bobId}/Bob private`,
		)!.sharename
		await writeSmbFile(bobSambaUsername, bobSambaPassword, bobSharename, 'private.txt', 'bob data')
	})

	test('Samba credentials cannot cross account boundaries', async () => {
		await expectSmbReadable('umbrel', ownerSambaPassword, ownerSharename, 'private.txt', 'owner data')
		await expectSmbReadable(aliceSambaUsername, aliceSambaPassword, aliceSharename, 'private.txt', 'alice data')
		await expectSmbReadable(bobSambaUsername, bobSambaPassword, bobSharename, 'private.txt', 'bob data')
		await expectSmbDenied('umbrel', ownerSambaPassword, aliceSharename)
		await expectSmbDenied(aliceSambaUsername, aliceSambaPassword, ownerSharename)
		await expectSmbDenied(aliceSambaUsername, aliceSambaPassword, bobSharename)
		await expectSmbDenied(bobSambaUsername, bobSambaPassword, aliceSharename)

		const config = await umbreld.vm.sshAsRoot('cat /etc/samba/smb.conf')
		expect(config).toContain(`valid users = ${aliceSystemUsername}`)
		expect(config).toContain(`valid users = ${bobSystemUsername}`)
		expect(config).toContain('valid users = umbrel')
		await expect(
			umbreld.vm.sshAsRoot('testparm -s /etc/samba/smb.conf >/dev/null 2>&1 && echo valid'),
		).resolves.toContain('valid')
	})

	test('member password rotation keeps the immutable username and invalidates the old password', async () => {
		await loginAs(aliceId, memberDashboardPassword)
		await umbreld.client.user.set.mutate({name: 'Renamed Alice'})
		expect(await umbreld.client.user.get.query()).toMatchObject({sambaUsername: aliceSambaUsername})

		const oldPassword = aliceSambaPassword
		aliceSambaPassword = 'alice-rotated-password'
		await umbreld.client.files.setSharePassword.mutate({password: aliceSambaPassword})
		await expectSmbReadable(aliceSambaUsername, aliceSambaPassword, aliceSharename, 'private.txt', 'alice data')
		await expectSmbDenied(aliceSambaUsername, oldPassword, aliceSharename)
	})

	test('credentials and account-owned shares survive a reboot', async () => {
		await loginAs('0', ownerDashboardPassword)
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await waitForSmbd()
		await loginAs('0', ownerDashboardPassword)

		await expectSmbReadable('umbrel', ownerSambaPassword, ownerSharename, 'private.txt', 'owner data')
		await expectSmbReadable(aliceSambaUsername, aliceSambaPassword, aliceSharename, 'private.txt', 'alice data')
		await expectSmbReadable(bobSambaUsername, bobSambaPassword, bobSharename, 'private.txt', 'bob data')
		expect(await mappedSystemUsername(aliceSambaUsername)).toBe(aliceSystemUsername)
		expect(await mappedSystemUsername(bobSambaUsername)).toBe(bobSystemUsername)
	})

	test('disabling a member revokes an active session and deletes its credential and shares', async () => {
		const activeAliceClient = createSmbClient(aliceSambaUsername, aliceSambaPassword, aliceSharename)
		expect(
			await withSmbTimeout(
				activeAliceClient.readFile('private.txt', {encoding: 'utf8'}),
				'open active Alice session before revocation',
			),
		).toBe('alice data')
		const activeAliceProcessId = await activeSmbProcessId(aliceSystemUsername)

		await loginAs('0', ownerDashboardPassword)
		await umbreld.client.files.setMemberSambaAccess.mutate({userId: aliceId, enabled: false})
		expect((await umbreld.client.files.memberSambaAccess.query()).find(({userId}) => userId === aliceId)).toEqual({
			userId: aliceId,
			enabled: false,
			username: aliceSambaUsername,
		})
		await expectSmbProcessStopped(activeAliceProcessId)
		disconnectSmbClient(activeAliceClient)
		await expectSmbDenied(aliceSambaUsername, aliceSambaPassword, aliceSharename)

		const cleanup = await umbreld.vm.sshAsRoot(`
			if getent passwd '${aliceSystemUsername}' >/dev/null; then echo system-present; else echo system-absent; fi
			if pdbedit -L | cut -d: -f1 | grep -Fx '${aliceSystemUsername}' >/dev/null; then echo passdb-present; else echo passdb-absent; fi
			if grep -F ' = ${aliceSambaUsername}' /etc/samba/username.map >/dev/null; then echo map-present; else echo map-absent; fi
		`)
		expect(cleanup).toContain('system-absent')
		expect(cleanup).toContain('passdb-absent')
		expect(cleanup).toContain('map-absent')

		await loginAs(aliceId, memberDashboardPassword)
		await expect(umbreld.client.files.sharePassword.query()).rejects.toThrow('[samba-access-disabled]')
		await expect(umbreld.client.files.shares.query()).rejects.toThrow('[samba-access-disabled]')
	})

	test('re-enabling creates a new password without restoring removed shares', async () => {
		await loginAs('0', ownerDashboardPassword)
		await umbreld.client.files.setMemberSambaAccess.mutate({userId: aliceId, enabled: true})

		await loginAs(aliceId, memberDashboardPassword)
		const replacementPassword = await umbreld.client.files.sharePassword.query()
		expect(replacementPassword).not.toBe(aliceSambaPassword)
		expect(await umbreld.client.files.shares.query()).toEqual([])
		await expectSmbDenied(aliceSambaUsername, replacementPassword, aliceSharename)

		aliceSambaPassword = replacementPassword
		await umbreld.client.files.addShare.mutate({path: `/Users/${aliceId}/Alice private`})
		aliceSharename = (await umbreld.client.files.shares.query())[0]!.sharename
		await expectSmbReadable(aliceSambaUsername, aliceSambaPassword, aliceSharename, 'private.txt', 'alice data')
	})

	test('deleting a member removes active access, passdb identity, share config, and dashboard login', async () => {
		const activeBobClient = createSmbClient(bobSambaUsername, bobSambaPassword, bobSharename)
		expect(
			await withSmbTimeout(
				activeBobClient.readFile('private.txt', {encoding: 'utf8'}),
				'open active Bob session before deletion',
			),
		).toBe('bob data')
		const activeBobProcessId = await activeSmbProcessId(bobSystemUsername)

		await loginAs('0', ownerDashboardPassword)
		await umbreld.client.user.deleteUser.mutate({userId: bobId})
		await expectSmbProcessStopped(activeBobProcessId)
		disconnectSmbClient(activeBobClient)
		await expectSmbDenied(bobSambaUsername, bobSambaPassword, bobSharename)
		await expect(
			umbreld.unauthenticatedClient.user.login.mutate({userId: bobId, password: memberDashboardPassword}),
		).rejects.toThrow('Incorrect password')

		const cleanup = await umbreld.vm.sshAsRoot(`
			if getent passwd '${bobSystemUsername}' >/dev/null; then echo system-present; else echo system-absent; fi
			if pdbedit -L | cut -d: -f1 | grep -Fx '${bobSystemUsername}' >/dev/null; then echo passdb-present; else echo passdb-absent; fi
			if grep -F ' = ${bobSambaUsername}' /etc/samba/username.map >/dev/null; then echo map-present; else echo map-absent; fi
			if grep -F '${bobSharename}' /etc/samba/smb.conf >/dev/null; then echo share-present; else echo share-absent; fi
		`)
		expect(cleanup).toContain('system-absent')
		expect(cleanup).toContain('passdb-absent')
		expect(cleanup).toContain('map-absent')
		expect(cleanup).toContain('share-absent')
	})

	test('deleted member access does not return after another reboot', async () => {
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await waitForSmbd()
		await loginAs('0', ownerDashboardPassword)

		await expectSmbReadable('umbrel', ownerSambaPassword, ownerSharename, 'private.txt', 'owner data')
		await expectSmbReadable(aliceSambaUsername, aliceSambaPassword, aliceSharename, 'private.txt', 'alice data')
		await expectSmbDenied(bobSambaUsername, bobSambaPassword, bobSharename)
		const config = await umbreld.vm.sshAsRoot('cat /etc/samba/smb.conf')
		expect(config).not.toContain(bobSystemUsername)
		expect(config).not.toContain(bobSharename)
	})
})
