import {createHash} from 'node:crypto'
import fsp from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import {isIP} from 'node:net'
import type {LookupFunction} from 'node:net'
import {lookup} from 'node:dns/promises'
import nodePath from 'node:path'
import {pipeline} from 'node:stream/promises'
import {Transform} from 'node:stream'

import fse from 'fs-extra'

const MAX_DOWNLOAD_BYTES = 100 * 1024 ** 3
const MAX_REDIRECTS = 5

function ipv4Number(address: string) {
	return address.split('.').reduce((value, part) => (value << 8) + Number(part), 0) >>> 0
}

function inIpv4Range(address: string, network: string, bits: number) {
	const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
	return (ipv4Number(address) & mask) === (ipv4Number(network) & mask)
}

export function isPrivateAddress(address: string) {
	if (address.startsWith('::ffff:')) return isPrivateAddress(address.slice(7))
	if (isIP(address) === 4) {
		return [
			['0.0.0.0', 8],
			['10.0.0.0', 8],
			['100.64.0.0', 10],
			['127.0.0.0', 8],
			['169.254.0.0', 16],
			['172.16.0.0', 12],
			['192.0.0.0', 24],
			['192.0.2.0', 24],
			['192.168.0.0', 16],
			['198.18.0.0', 15],
			['198.51.100.0', 24],
			['203.0.113.0', 24],
			['224.0.0.0', 4],
			['240.0.0.0', 4],
		].some(([network, bits]) => inIpv4Range(address, network as string, bits as number))
	}
	const normalized = address.toLowerCase()
	return (
		normalized === '::' ||
		normalized === '::1' ||
		normalized.startsWith('fc') ||
		normalized.startsWith('fd') ||
		normalized.startsWith('fe8') ||
		normalized.startsWith('fe9') ||
		normalized.startsWith('fea') ||
		normalized.startsWith('feb') ||
		normalized.startsWith('ff') ||
		normalized.startsWith('2001:db8:')
	)
}

async function resolvePublicAddresses(hostname: string) {
	const addresses = await lookup(hostname, {all: true, verbatim: true})
	if (addresses.length === 0 || addresses.some(({address}) => isPrivateAddress(address))) {
		throw new Error('[machine-image-url-private-address]')
	}
	return addresses
}

// Keep connections pinned to the validated DNS answers while letting Node's
// autoSelectFamily try another address when the first one is unreachable.
export function createPinnedLookup(pinned: {address: string; family: number}[]): LookupFunction {
	return (_hostname, options, callback) => {
		if (options.all) return callback(null, pinned)
		callback(null, pinned[0].address, pinned[0].family)
	}
}

export type DownloadProgress = {downloadedBytes: number; totalBytes?: number; percent?: number}

export async function safeDownload({
	url,
	destination,
	expectedSha256,
	onProgress,
	signal,
}: {
	url: string
	destination: string
	expectedSha256?: string
	onProgress?: (progress: DownloadProgress) => void
	signal?: AbortSignal
}) {
	await fse.ensureDir(nodePath.dirname(destination))
	const temporary = `${destination}.${process.pid}.download`
	await fse.remove(temporary)

	const download = async (currentUrl: URL, redirects: number): Promise<{sha256: string; size: number}> => {
		if (!['http:', 'https:'].includes(currentUrl.protocol) || currentUrl.username || currentUrl.password) {
			throw new Error('[machine-image-url-invalid]')
		}
		if (redirects > MAX_REDIRECTS) throw new Error('[machine-image-too-many-redirects]')

		const pinned = await resolvePublicAddresses(currentUrl.hostname)
		const transport = currentUrl.protocol === 'https:' ? https : http
		return new Promise((resolve, reject) => {
			const request = transport.get(
				currentUrl,
				{
					headers: {'user-agent': 'umbreld-machines/1'},
					lookup: createPinnedLookup(pinned),
				},
				async (response) => {
					try {
						if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
							const location = response.headers.location
							response.resume()
							if (!location) throw new Error('[machine-image-redirect-invalid]')
							return resolve(await download(new URL(location, currentUrl), redirects + 1))
						}
						if (response.statusCode !== 200) {
							response.resume()
							throw new Error(`[machine-image-download-http-error] ${response.statusCode}`)
						}

						const totalBytes = response.headers['content-length']
							? Number(response.headers['content-length'])
							: undefined
						if (totalBytes && totalBytes > MAX_DOWNLOAD_BYTES) throw new Error('[machine-image-too-large]')
						let downloadedBytes = 0
						let lastProgressAt = 0
						const hash = createHash('sha256')
						const progress = new Transform({
							transform(chunk, _encoding, callback) {
								downloadedBytes += chunk.length
								if (downloadedBytes > MAX_DOWNLOAD_BYTES) return callback(new Error('[machine-image-too-large]'))
								hash.update(chunk)
								const now = Date.now()
								if (now - lastProgressAt >= 1_000) {
									lastProgressAt = now
									onProgress?.({
										downloadedBytes,
										totalBytes,
										percent: totalBytes ? (downloadedBytes / totalBytes) * 100 : undefined,
									})
								}
								callback(null, chunk)
							},
						})
						await pipeline(response, progress, fse.createWriteStream(temporary, {mode: 0o600}), {signal})
						const sha256 = hash.digest('hex')
						if (expectedSha256 && sha256 !== expectedSha256.toLowerCase()) {
							throw new Error('[machine-image-checksum-mismatch]')
						}
						onProgress?.({downloadedBytes, totalBytes, percent: 100})
						resolve({sha256, size: downloadedBytes})
					} catch (error) {
						reject(error)
					}
				},
			)
			request.on('error', reject)
			signal?.addEventListener('abort', () => request.destroy(signal.reason as Error), {once: true})
		})
	}

	try {
		const result = await download(new URL(url), 0)
		await fsp.rename(temporary, destination)
		return result
	} catch (error) {
		await fse.remove(temporary)
		throw error
	}
}
