import {execa} from 'execa'

import type Umbreld from '../../index.ts'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeDnsName(value: unknown) {
	if (typeof value !== 'string') return null
	const normalized = value.trim().toLowerCase().replace(/\.$/, '')
	if (!normalized || normalized.length > 253) return null
	const labels = normalized.split('.')
	if (
		labels.some((label) => label.length === 0 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
	)
		return null
	return normalized
}

// Tailscale is the authority for its browser hostname. Validate the small status
// subset we consume instead of deriving it from an IP, account name, or hostname.
export function parseTailscaleBrowserHostname(value: unknown): string | null {
	if (!isRecord(value) || value.BackendState !== 'Running') return null
	if (!isRecord(value.Self)) return null
	if (!isRecord(value.CurrentTailnet) || value.CurrentTailnet.MagicDNSEnabled !== true) return null

	const dnsName = normalizeDnsName(value.Self.DNSName)
	const suffix = normalizeDnsName(value.CurrentTailnet.MagicDNSSuffix)
	if (!dnsName || !suffix || !dnsName.endsWith(`.${suffix}`)) return null
	const shortName = dnsName.slice(0, -(suffix.length + 1))
	if (shortName.includes('.')) return null
	// Native clients only need Tailscale's documented short browser name. Do not
	// expose the user's private tailnet suffix as general device metadata.
	return shortName
}

// The Tailscale app owns tailscaled, so ask its local CLI for the authoritative
// browser hostname. This metadata is optional: every failure safely falls back to
// the already-reported Tailscale and LAN IP addresses.
export async function getTailscaleBrowserHostname(umbreld: Umbreld): Promise<string | null> {
	// Note: This is a temporary workaround because native remote access is not yet
	// available. umbrelOS should not reach across the app boundary and depend on an
	// app's internal Compose layout, but there is currently no better way to obtain
	// this value. Replace this when a supported remote-access interface exists.
	const app = umbreld.apps.instances.find(({id}) => id === 'tailscale')
	if (!app) return null

	try {
		const compose = await app.readCompose()
		const containerName = compose.services?.web?.container_name
		if (!containerName) {
			umbreld.logger.verbose('Tailscale browser hostname unavailable: app has no web container')
			return null
		}

		const {stdout} = await execa(
			'docker',
			['exec', containerName, 'timeout', '-s', 'KILL', '3', 'tailscale', 'status', '--json', '--peers=false'],
			{
				// The in-container timeout kills a wedged status process. This longer
				// host timeout bounds Docker itself without leaving that child behind.
				timeout: 5_000,
				maxBuffer: 256 * 1_024,
			},
		)
		return parseTailscaleBrowserHostname(JSON.parse(stdout))
	} catch (error) {
		umbreld.logger.verbose(`Tailscale browser hostname unavailable: ${error}`)
		return null
	}
}
