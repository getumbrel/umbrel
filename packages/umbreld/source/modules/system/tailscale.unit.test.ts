import {afterEach, describe, expect, test, vi} from 'vitest'

import {execa} from 'execa'

import type Umbreld from '../../index.ts'
import {getTailscaleBrowserHostname, parseTailscaleBrowserHostname} from './tailscale.ts'

vi.mock('execa')

afterEach(() => {
	vi.resetAllMocks()
})

function status(overrides: Record<string, unknown> = {}) {
	return {
		BackendState: 'Running',
		Self: {
			DNSName: 'my-umbrel.example-tailnet.ts.net.',
			Online: true,
		},
		CurrentTailnet: {
			MagicDNSSuffix: 'example-tailnet.ts.net',
			MagicDNSEnabled: true,
		},
		...overrides,
	}
}

describe('parseTailscaleBrowserHostname', () => {
	test('returns the authoritative normalized node name', () => {
		expect(parseTailscaleBrowserHostname(status())).toBe('my-umbrel')
	})

	test('requires a running node with MagicDNS enabled', () => {
		expect(parseTailscaleBrowserHostname(status({BackendState: 'Stopped'}))).toBeNull()
		expect(
			parseTailscaleBrowserHostname(
				status({CurrentTailnet: {MagicDNSSuffix: 'example-tailnet.ts.net', MagicDNSEnabled: false}}),
			),
		).toBeNull()
	})

	test('keeps the stable hostname during a control-plane disconnect', () => {
		expect(
			parseTailscaleBrowserHostname(status({Self: {DNSName: 'my-umbrel.example-tailnet.ts.net.', Online: false}})),
		).toBe('my-umbrel')
	})

	test('rejects malformed names and names outside the reported tailnet', () => {
		expect(
			parseTailscaleBrowserHostname(status({Self: {DNSName: 'different-tailnet.ts.net.', Online: true}})),
		).toBeNull()
		expect(
			parseTailscaleBrowserHostname(status({Self: {DNSName: 'bad_name.example-tailnet.ts.net.', Online: true}})),
		).toBeNull()
		expect(
			parseTailscaleBrowserHostname(status({Self: {DNSName: 'nested.name.example-tailnet.ts.net.', Online: true}})),
		).toBeNull()
	})
})

function umbreldWithApps(instances: unknown[]) {
	return {
		apps: {instances},
		logger: {verbose: vi.fn()},
	} as unknown as Umbreld
}

describe('getTailscaleBrowserHostname', () => {
	test('returns null without an installed Tailscale app', async () => {
		const umbreld = umbreldWithApps([])

		await expect(getTailscaleBrowserHostname(umbreld)).resolves.toBeNull()
		expect(execa).not.toHaveBeenCalled()
	})

	test('reads the authoritative status with bounded container and host runtimes', async () => {
		const readCompose = vi.fn().mockResolvedValue({services: {web: {container_name: 'tailscale_web_1'}}})
		const umbreld = umbreldWithApps([{id: 'tailscale', readCompose}])
		vi.mocked(execa).mockResolvedValue({stdout: JSON.stringify(status())} as never)

		await expect(getTailscaleBrowserHostname(umbreld)).resolves.toBe('my-umbrel')
		expect(execa).toHaveBeenCalledWith(
			'docker',
			['exec', 'tailscale_web_1', 'timeout', '-s', 'KILL', '3', 'tailscale', 'status', '--json', '--peers=false'],
			{timeout: 5_000, maxBuffer: 256 * 1_024},
		)
	})

	test('logs and returns null when the expected app service changes', async () => {
		const umbreld = umbreldWithApps([
			{id: 'tailscale', readCompose: vi.fn().mockResolvedValue({services: {renamed: {}}})},
		])

		await expect(getTailscaleBrowserHostname(umbreld)).resolves.toBeNull()
		expect(umbreld.logger.verbose).toHaveBeenCalledOnce()
		expect(execa).not.toHaveBeenCalled()
	})

	test('logs and returns null for command or response failures', async () => {
		const umbreld = umbreldWithApps([
			{
				id: 'tailscale',
				readCompose: vi.fn().mockResolvedValue({services: {web: {container_name: 'tailscale_web_1'}}}),
			},
		])
		vi.mocked(execa).mockRejectedValueOnce(new Error('container stopped'))

		await expect(getTailscaleBrowserHostname(umbreld)).resolves.toBeNull()
		expect(umbreld.logger.verbose).toHaveBeenCalledOnce()

		vi.mocked(execa).mockResolvedValueOnce({stdout: 'not json'} as never)
		await expect(getTailscaleBrowserHostname(umbreld)).resolves.toBeNull()
		expect(umbreld.logger.verbose).toHaveBeenCalledTimes(2)
	})
})
