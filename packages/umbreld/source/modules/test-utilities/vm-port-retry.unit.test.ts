import {describe, expect, test, vi} from 'vitest'

import {qemuHostForwardCollisionPort, retryVmPortCollisions} from './vm-port-retry.ts'

const collision = (hostPort: number, guestPort = 80) =>
	new Error(
		`VM process exited unexpectedly:\nqemu-system-x86_64: Could not set up host forwarding rule 'tcp:127.0.0.1:${hostPort}-:${guestPort}'`,
	)

describe('VM port collision retries', () => {
	test('extracts the conflicting host port from QEMU output', () => {
		expect(qemuHostForwardCollisionPort(collision(44_037))).toBe(44_037)
		expect(qemuHostForwardCollisionPort(new Error('VM process exited unexpectedly'))).toBeUndefined()
	})

	test('refreshes dynamic ports and retries the VM boot', async () => {
		const attempt = vi.fn().mockRejectedValueOnce(collision(44_037)).mockResolvedValue('booted')
		const refreshPorts = vi.fn().mockResolvedValue(undefined)

		await expect(
			retryVmPortCollisions({
				attempt,
				refreshPorts,
				isDynamicPort: (port) => port === 44_037,
			}),
		).resolves.toBe('booted')
		expect(attempt).toHaveBeenCalledTimes(2)
		expect(refreshPorts).toHaveBeenCalledTimes(1)
	})

	test('does not retry fixed ports or unrelated VM failures', async () => {
		const refreshPorts = vi.fn().mockResolvedValue(undefined)
		const fixedPortAttempt = vi.fn().mockRejectedValue(collision(44_037))

		await expect(
			retryVmPortCollisions({
				attempt: fixedPortAttempt,
				refreshPorts,
				isDynamicPort: () => false,
			}),
		).rejects.toThrow('Could not set up host forwarding rule')
		expect(fixedPortAttempt).toHaveBeenCalledTimes(1)

		const unrelatedError = new Error('VM process exited unexpectedly')
		const unrelatedAttempt = vi.fn().mockRejectedValue(unrelatedError)
		await expect(
			retryVmPortCollisions({
				attempt: unrelatedAttempt,
				refreshPorts,
				isDynamicPort: () => true,
			}),
		).rejects.toBe(unrelatedError)
		expect(unrelatedAttempt).toHaveBeenCalledTimes(1)
		expect(refreshPorts).not.toHaveBeenCalled()
	})

	test('stops after five retries', async () => {
		const attempt = vi.fn().mockRejectedValue(collision(44_037))
		const refreshPorts = vi.fn().mockResolvedValue(undefined)

		await expect(
			retryVmPortCollisions({
				attempt,
				refreshPorts,
				isDynamicPort: () => true,
			}),
		).rejects.toThrow('Could not set up host forwarding rule')
		expect(attempt).toHaveBeenCalledTimes(6)
		expect(refreshPorts).toHaveBeenCalledTimes(5)
	})
})
