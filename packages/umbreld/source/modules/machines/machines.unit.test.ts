import {createHash, randomUUID} from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import pWaitFor from 'p-wait-for'
import {afterEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'

import type {MachineDefinition} from './domain.ts'
import MachineStore from './machine-store.ts'
import Machines, {FIRST_BOOT_SETUP_TIMEOUT_MS} from './machines.ts'

const roots: string[] = []
let machines: Machines | undefined

afterEach(async () => {
	await machines?.stop()
	machines = undefined
	await Promise.all(roots.splice(0).map((root) => fse.remove(root)))
})

function definition(id: string, token: string): MachineDefinition {
	return {
		version: 1,
		id,
		name: 'Slow setup machine',
		osId: 'windows-11',
		osName: 'Windows 11',
		osVersion: 'Windows 11',
		arch: 'amd64',
		platformProfile: 'modern-x86',
		machineType: 'pc-q35-9.2',
		firmware: 'uefi',
		uuid: randomUUID(),
		macAddress: '02:00:00:00:00:01',
		diskSizeGb: 32,
		cores: 2,
		memoryMb: 4_096,
		autostart: false,
		pinned: false,
		createdAt: Date.now(),
		firstBootSetup: {
			startedAt: Date.now() - FIRST_BOOT_SETUP_TIMEOUT_MS,
			tokenHash: createHash('sha256').update(token).digest('hex'),
		},
		portForwards: [],
	}
}

describe('Machines first-boot completion', () => {
	test('keeps manual first-boot setup ready for the interactive installer', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'machines-manual-first-boot-'))
		roots.push(root)
		const id = randomUUID()
		const token = 'ab'.repeat(32)
		const machine = definition(id, token)
		machine.firstBootSetup = {...machine.firstBootSetup!, manual: true}
		const store = new MachineStore(root)
		await store.start()
		await store.write(machine)

		machines = new Machines({
			dataDirectory: root,
			port: 3_006,
			logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
			eventBus: {emit: vi.fn()},
		} as unknown as Umbreld)
		await machines.start()

		expect((await machines.list()).find((candidate) => candidate.id === id)).toMatchObject({
			firstBootSetup: false,
			installationState: 'ready-for-setup',
		})
	})

	test('a delayed setup remains pending and accepts its authenticated completion callback', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'machines-first-boot-'))
		roots.push(root)
		const id = randomUUID()
		const token = 'ab'.repeat(32)
		const machine = definition(id, token)
		const store = new MachineStore(root)
		await store.start()
		await store.write(machine)

		const emit = vi.fn()
		const childLogger = {log: vi.fn(), error: vi.fn()}
		machines = new Machines({
			dataDirectory: root,
			port: 3_006,
			logger: {createChildLogger: () => childLogger},
			eventBus: {emit},
		} as unknown as Umbreld)
		await machines.start()

		// Wait until the normal one-second poll has observed this definition.
		// The public view keeps the delayed setup pending, and the callback
		// credential remains persisted so the guest can still report success.
		await pWaitFor(
			() =>
				emit.mock.calls.some(
					([event, payload]) =>
						event === 'machines:updated' && Array.isArray(payload) && payload.some((candidate) => candidate.id === id),
				),
			{interval: 25, timeout: 5_000},
		)
		expect((await machines.list()).find((candidate) => candidate.id === id)).toMatchObject({
			firstBootSetup: true,
			installationState: 'setup-delayed',
		})
		await expect(store.read(id)).resolves.toMatchObject({firstBootSetup: machine.firstBootSetup})

		await expect(machines.completeFirstBootSetup(id, 'cd'.repeat(32))).rejects.toThrow(
			'[machine-first-boot-token-invalid]',
		)
		await expect(store.read(id)).resolves.toMatchObject({firstBootSetup: machine.firstBootSetup})

		await expect(machines.completeFirstBootSetup(id, token)).resolves.toBe(true)
		expect((await store.read(id)).firstBootSetup).toBeUndefined()
		expect((await machines.list()).find((candidate) => candidate.id === id)).toMatchObject({
			firstBootSetup: false,
			installationState: undefined,
		})
	}, 10_000)
})
