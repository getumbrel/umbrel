import {once} from 'node:events'
import net from 'node:net'
import path from 'node:path'

import fse from 'fs-extra'
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'

import {createTestVm} from './create-test-umbreld.ts'

describe.sequential('VM QMP isolation', () => {
	let first: Awaited<ReturnType<typeof createTestVm>>
	let second: Awaited<ReturnType<typeof createTestVm>>
	let failed = false

	beforeAll(async () => {
		first = await createTestVm({device: 'umbrel-home', stateDirectoryName: 'vm-state'})
		second = await createTestVm({device: 'umbrel-home', stateDirectoryName: 'vm-state'})
	})

	afterAll(async () => {
		await first?.cleanup()
		await second?.cleanup()
	})

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('creates independent state directories with the same basename', () => {
		expect(first.vm.stateDir).not.toBe(second.vm.stateDir)
		expect(path.basename(first.vm.stateDir)).toBe('vm-state')
		expect(path.basename(second.vm.stateDir)).toBe('vm-state')
	})

	test('adds one USB disk to each stopped VM', async () => {
		await first.vm.addUsbStorage({slot: 1})
		await second.vm.addUsbStorage({slot: 1})
	})

	test('retries a host-port collision while booting both VMs concurrently', async () => {
		const blockedPort = first.vm.httpPort
		const blocker = net.createServer((socket) => socket.destroy())
		blocker.listen(blockedPort, '127.0.0.1')
		await once(blocker, 'listening')

		try {
			await Promise.all([first.vm.powerOn(), second.vm.powerOn()])
			expect(first.vm.httpPort).not.toBe(blockedPort)
		} finally {
			await new Promise<void>((resolve, reject) => blocker.close((error) => (error ? reject(error) : resolve())))
		}
	})

	test('rejects adding a new USB disk to a running VM without changing its state', async () => {
		const usbStatePath = path.join(first.vm.stateDir, 'usb.json')
		const diskPath = path.join(first.vm.stateDir, 'usb-slot2.qcow2')
		const stateBefore = await fse.readFile(usbStatePath, 'utf8')

		await expect(first.vm.addUsbStorage({slot: 2})).rejects.toThrow(
			'Adding new USB storage while the VM is running is not supported',
		)

		await expect(fse.pathExists(diskPath)).resolves.toBe(false)
		await expect(fse.readFile(usbStatePath, 'utf8')).resolves.toBe(stateBefore)
	})

	test('disconnects each VM USB disk through its own QMP endpoint', async () => {
		await first.vm.disconnectUsbStorage({slot: 1})
		await second.vm.disconnectUsbStorage({slot: 1})
	})

	test('reconnects each VM USB disk through its own QMP endpoint', async () => {
		await first.vm.connectUsbStorage({slot: 1})
		await second.vm.connectUsbStorage({slot: 1})
	})
})
