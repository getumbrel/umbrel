import net from 'node:net'

import {z} from 'zod'

export function isDnsHostname(value: string) {
	return (
		value.length <= 253 &&
		!net.isIP(value) &&
		value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
	)
}

export const NativeTlsHostnameSuffixesSchema = z
	.array(z.string().refine((name) => name.includes('.') && isDnsHostname(name)))
	.min(1)
	.max(16)
	.transform((names) => [...new Set(names.map((name) => name.toLowerCase()))].sort())

export type NativeTlsPolicy = {hostnameSuffixes: string[]; reservedHostnames: string[]}

export function getNativeTlsPolicy(metadata: unknown, services: unknown, reservedHostnames: string[]) {
	// Keep the gateway path even when its packaged config is invalid or auth is disabled.
	if (!services || typeof services !== 'object' || Array.isArray(services)) return
	if (Object.hasOwn(services, 'app_proxy')) return
	const result = NativeTlsHostnameSuffixesSchema.safeParse(metadata)
	if (!result.success) return
	return {
		hostnameSuffixes: result.data,
		reservedHostnames: [...new Set(reservedHostnames.map((name) => name.toLowerCase()))].sort(),
	}
}

export function matchesNativeTlsHostname(hostname: string | undefined, policy: NativeTlsPolicy) {
	if (!hostname || !isDnsHostname(hostname)) return false
	const name = hostname.toLowerCase()
	if (name === 'localhost' || name.endsWith('.localhost') || name === 'local' || name.endsWith('.local')) return false
	if (policy.reservedHostnames.includes(name)) return false
	// Match whole DNS labels, including descendants with multiple labels.
	return policy.hostnameSuffixes.some((suffix) => name === suffix || name.endsWith(`.${suffix}`))
}
