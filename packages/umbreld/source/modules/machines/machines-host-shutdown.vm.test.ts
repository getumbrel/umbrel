import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, test} from 'vitest'
import pRetry from 'p-retry'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

const READY_MARKER = 'UMBREL-FIXTURE-READY'
const SHUTDOWN_MARKER = 'UMBREL-GRACEFUL-SHUTDOWN'
const READY_SECTOR = 3
const SHUTDOWN_SECTOR = 2

// A tiny BIOS guest that behaves like a real OS on ACPI power-off. It enables
// the Q35 power button event, records that it is listening in disk sector 3,
// then idles, checking PM1_STS each time the BIOS timer wakes it. Once the
// button is pressed it writes a marker to disk sector 2 through INT 13h before
// entering S5. The shutdown marker can only exist if the guest received the
// ACPI shutdown and was allowed to act on it, so a forced kill leaves it absent.
const READY_OFFSET = 0x50
const SHUTDOWN_OFFSET = 0x70
function acpiShutdownDisk() {
	const disk = Buffer.alloc(1024 * 1024)
	const program = [
		[0xfa], // cli
		[0x31, 0xc0], // xor ax, ax
		[0x8e, 0xd8], // mov ds, ax
		[0x8e, 0xc0], // mov es, ax
		[0x89, 0xd6], // mov si, dx (keep the BIOS boot drive)
		[0xba, 0x02, 0x06], // mov dx, 0x602 (PM1_EN)
		[0xb8, 0x00, 0x01], // mov ax, PWRBTN_EN
		[0xef], // out dx, ax
		[0xb8, 0x01, 0x03], // mov ax, 0x0301 (write one sector)
		[0xb9, READY_SECTOR, 0x00], // mov cx, sector (cylinder 0)
		[0x89, 0xf2], // mov dx, si
		[0xb6, 0x00], // mov dh, 0
		[0xbb, READY_OFFSET, 0x7c], // mov bx, ready marker
		[0xcd, 0x13], // int 0x13
		[0xfb], // sti
		[0xf4], // poll: hlt (until the next timer tick)
		[0xba, 0x00, 0x06], // mov dx, 0x600 (PM1_STS)
		[0xed], // in ax, dx
		[0xa9, 0x00, 0x01], // test ax, PWRBTN_STS
		[0x74, 0xf6], // jz poll
		[0xb8, 0x01, 0x03], // mov ax, 0x0301 (write one sector)
		[0xb9, SHUTDOWN_SECTOR, 0x00], // mov cx, sector (cylinder 0)
		[0x89, 0xf2], // mov dx, si
		[0xb6, 0x00], // mov dh, 0
		[0xbb, SHUTDOWN_OFFSET, 0x7c], // mov bx, shutdown marker
		[0xcd, 0x13], // int 0x13
		[0xba, 0x04, 0x06], // mov dx, 0x604 (PM1_CNT)
		[0xb8, 0x00, 0x20], // mov ax, SLP_EN | S5
		[0xef], // out dx, ax
		[0xfa], // cli
		[0xf4], // hlt
		[0xeb, 0xfd], // jmp hlt
	].flat()
	if (program.length > READY_OFFSET || READY_OFFSET + READY_MARKER.length > SHUTDOWN_OFFSET) {
		throw new Error('Shutdown fixture program and markers overlap')
	}
	disk.set(program)
	disk.write(READY_MARKER, READY_OFFSET, 'ascii')
	disk.write(SHUTDOWN_MARKER, SHUTDOWN_OFFSET, 'ascii')
	disk.set([0x55, 0xaa], 510)
	return disk
}

describe('Umbrel Machines host shutdown', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>

	// Read a marker the guest wrote to one of its disk sectors, straight out of
	// its canonical disk. CHS sectors are numbered from 1.
	const readMarker = (machineId: string, sector: number, marker: string) =>
		umbreld.vm.sshAsRoot(`
set -eu
file=$(mktemp)
qemu-img dd -U -f qcow2 -O raw bs=512 count=${sector} if=/home/umbrel/umbrel/machines/${machineId}/disk.qcow2 of="$file"
tail -c +${(sector - 1) * 512 + 1} "$file" | head -c ${marker.length} | tr -d '\\0'
rm -f "$file"
`)
	const readShutdownMarker = (machineId: string) => readMarker(machineId, SHUTDOWN_SECTOR, SHUTDOWN_MARKER)

	const createRunningMachine = async (name: string) => {
		const machine = await umbreld.client.machines.create.mutate({
			name,
			imagePath: '/Home/acpi-shutdown.img',
			arch: 'amd64',
			firmware: 'bios',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pRetry(
			async () => {
				const current = (await umbreld.client.machines.list.query()).find(({id}) => id === machine.id)
				expect(current?.state).toBe('running')
			},
			{retries: 120, minTimeout: 500, maxTimeout: 500},
		)
		// Libvirt reports the domain running as soon as QEMU starts. Wait until the
		// guest is listening for the power button, since QEMU drops the event
		// before then.
		await pRetry(async () => expect(await readMarker(machine.id, READY_SECTOR, READY_MARKER)).toBe(READY_MARKER), {
			retries: 120,
			minTimeout: 500,
			maxTimeout: 500,
		})
		expect(await readShutdownMarker(machine.id)).toBe('')
		return machine.id
	}

	// Wait for a genuinely clean poweroff rather than using vm.powerOff(), whose
	// force-kill fallback would lose the shutdown journal on a slow emulated host.
	const waitForPoweroffAndBoot = async () => {
		await pWaitFor(() => !umbreld.vm.isRunning(), {interval: 1_000, timeout: 300_000})
		await umbreld.vm.waitForShutdown()
		await umbreld.vm.powerOn()
		await umbreld.login()
	}

	// The full shutdown sequence from the previous boot, logged for diagnosis
	const previousShutdownLog = async () => {
		const log = await umbreld.vm.sshAsRoot(
			`journalctl -b -1 --no-pager -o short-precise -u umbrel.service -u libvirtd.service -u virtlogd.service | grep -Ev ']: +at '; journalctl -b -1 --no-pager -o short-precise -t umbrel-power-button`,
		)
		console.log(log)
		return log
	}

	beforeAll(async () => {
		const image = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../os/build/umbrelos-amd64.img')
		umbreld = await createTestVm({device: 'umbrel-home', image, memory: 4096})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()

		// Libvirt is activated on first use, as when the UI opens Machines
		const capabilities = await umbreld.client.machines.capabilities.query()
		expect(capabilities.libvirtAvailable).toBe(true)

		await umbreld.api.post('files/upload?path=/Home/acpi-shutdown.img', {body: acpiShutdownDisk()})
	})

	afterAll(async () => await umbreld?.cleanup())

	test('the fixture guest records a graceful ACPI shutdown when stopped through the API', async () => {
		const machineId = await createRunningMachine('ACPI fixture check')

		// A normal stop sends ACPI power-off and waits for the guest to exit
		await umbreld.client.machines.stop.mutate({id: machineId})
		expect(await readShutdownMarker(machineId)).toBe(SHUTDOWN_MARKER)

		await umbreld.client.machines.uninstall.mutate({id: machineId})
	})

	describe('shutdown from the UI', () => {
		let machineIds: string[]

		test('starts two machines', async () => {
			machineIds = [await createRunningMachine('UI shutdown one'), await createRunningMachine('UI shutdown two')]
		})

		test('shuts down the host from the UI and boots it again', async () => {
			// The call can reject as the connection drops
			await umbreld.client.system.shutdown.mutate().catch(() => {})
			await waitForPoweroffAndBoot()
		})

		test('every running machine received a graceful ACPI shutdown', async () => {
			for (const id of machineIds) expect.soft(await readShutdownMarker(id), id).toBe(SHUTDOWN_MARKER)
		})

		test('umbreld stopped cleanly', async () => {
			const log = await previousShutdownLog()
			expect(log).toContain('Received SIGTERM, shutting down cleanly')
			expect.soft(log).not.toContain('forcing it off')
			expect.soft(log).not.toContain('Failed to stop umbreld')
		})

		test('removes the machines', async () => {
			for (const id of machineIds) await umbreld.client.machines.uninstall.mutate({id})
		})
	})

	describe('shutdown from the power button', () => {
		let machineIds: string[]

		test('starts two machines', async () => {
			machineIds = [
				await createRunningMachine('Button shutdown one'),
				await createRunningMachine('Button shutdown two'),
			]
		})

		test('shuts down the host with the power button and boots it again', async () => {
			await umbreld.vm.pressPowerButton()
			await waitForPoweroffAndBoot()
		})

		test('every running machine received a graceful ACPI shutdown', async () => {
			for (const id of machineIds) expect.soft(await readShutdownMarker(id), id).toBe(SHUTDOWN_MARKER)
		})

		test('umbreld stopped cleanly', async () => {
			const log = await previousShutdownLog()
			expect(log).toContain('Received SIGTERM, shutting down cleanly')
			expect.soft(log).not.toContain('forcing it off')
			expect.soft(log).not.toContain('Failed to stop umbreld')
		})

		test('removes the machines', async () => {
			for (const id of machineIds) await umbreld.client.machines.uninstall.mutate({id})
		})
	})
})
