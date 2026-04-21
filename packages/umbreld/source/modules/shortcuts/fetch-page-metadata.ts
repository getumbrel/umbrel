import https from 'node:https'

import fetch from 'node-fetch'
import {z} from 'zod'

const TIMEOUT_MS = 3000
const MIN_ICON_SIZE = 64
const agent = new https.Agent({rejectUnauthorized: false})

const manifestSchema = z.object({
	icons: z
		.array(
			z.object({
				src: z.string().min(1),
				sizes: z.string().optional(),
				purpose: z.string().optional(),
			}),
		)
		.optional(),
})

// Fetch shortcut metadata from a page by reading the head once, then choosing
// the first usable image source in this order:

// apple-touch-icon (first one) -> manifest icon  (largest size, and prefer any
// over maskable) -> meta itemprop="image" (first one) -> rel="icon" (largest size)
// -> /favicon.ico (try hitting directly)

export async function fetchPageMetadata(url: string): Promise<{title: string; icon: string | undefined}> {
	const pageUrl = new URL(url)
	const fallbackTitle = pageUrl.hostname === 'localhost' ? `Port ${pageUrl.port}` : pageUrl.hostname

	const response = await fetchPage(pageUrl)
	const html = response ? await response.text().catch(() => undefined) : undefined
	const base = response ? new URL(response.url) : pageUrl
	const head = html ? (html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? html) : undefined

	const icon = head
		? (findAppleTouchIcon(head, base) ??
			(await fetchManifestIcon(findManifestHref(head, base)).catch(() => undefined)) ??
			findMetaImage(head, base) ??
			(await probeAppleTouchIcon(base).catch(() => undefined)) ??
			findIcon(head, base) ??
			(await fetchFavicon(base).catch(() => undefined)))
		: ((await probeAppleTouchIcon(base).catch(() => undefined)) ?? (await fetchFavicon(base).catch(() => undefined)))

	const title = head ? findTitle(head) : undefined

	return {title: title ?? fallbackTitle, icon}
}

async function fetchPage(url: URL) {
	const response = await doFetch(url, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
	if (!response) return undefined
	const ct = response.headers.get('content-type') ?? ''
	if (ct && !ct.includes('html') && !ct.includes('xml') && !ct.startsWith('text/')) {
		response.body?.resume()
		return undefined
	}
	return response
}

function findTitle(head: string) {
	const raw = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
	if (!raw) return undefined

	// Find the first separator (|, -, :, –, —, ·, •, », «) in the raw title
	// Split there and pick the shorter side (e.g. "Dashboard | A Very Long Website Name" → "Dashboard")
	// Fall back to the full title if no separator is found or either side is empty
	// Slice to 100 characters
	const index = raw.search(/[|\-:–—·•»«]/)
	if (index !== -1) {
		const left = raw.slice(0, index).trim()
		const right = raw.slice(index + 1).trim()
		if (left && right) return (left.length <= right.length ? left : right).slice(0, 50)
	}
	return raw.slice(0, 100)
}

function findAppleTouchIcon(head: string, base: URL) {
	const match = head.match(
		/<link\b(?=[^>]*\brel\s*=\s*["'][^"']*apple-touch-icon[^"']*["'])(?=[^>]*\bhref\s*=\s*["']([^"']+)["'])[^>]*>/i,
	)
	return resolve(match?.[1], base)
}

function findManifestHref(head: string, base: URL) {
	const match = head.match(
		/<link\b(?=[^>]*\brel\s*=\s*["'](?:[^"']*\s)?manifest(?:\s[^"']*)?["'])(?=[^>]*\bhref\s*=\s*["']([^"']+)["'])[^>]*>/i,
	)
	const href = resolve(match?.[1], base)
	return href && /^https?:/.test(href) ? href : undefined
}

function findMetaImage(head: string, base: URL) {
	const match = head.match(
		/<meta\b(?=[^>]*\bitemprop\s*=\s*["'][^"']*image[^"']*["'])(?=[^>]*\bcontent\s*=\s*["']([^"']+)["'])[^>]*>/i,
	)
	return resolve(match?.[1], base)
}

function findIcon(head: string, base: URL) {
	const tags = head.matchAll(
		/<link\b(?=[^>]*\brel\s*=\s*["'](?:[^"']*\s)?icon(?:\s[^"']*)?["'])(?=[^>]*\bhref\s*=\s*["']([^"']+)["'])[^>]*>/gi,
	)
	let first: string | undefined
	let best: string | undefined
	let bestSize = 0
	for (const tag of tags) {
		const href = resolve(tag[1], base)
		if (!href) continue
		first ??= href
		const size = parseSize(tag[0].match(/\bsizes\s*=\s*["']([^"']+)["']/i)?.[1])
		if (size >= MIN_ICON_SIZE && size > bestSize) {
			best = href
			bestSize = size
		}
	}
	return best ?? first
}

async function fetchManifestIcon(href: string | undefined) {
	if (!href) return undefined
	const response = await doFetch(
		new URL(href),
		'application/manifest+json,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.7',
	)
	if (!response) return undefined
	const ct = response.headers.get('content-type') ?? ''
	if (ct && !ct.includes('json') && !ct.startsWith('text/')) {
		response.body?.resume()
		return undefined
	}
	const data = await response
		.text()
		.then(JSON.parse)
		.catch(() => undefined)
	const manifest = manifestSchema.safeParse(data)
	if (!manifest.success) return undefined
	const icons = manifest.data.icons ?? []
	const base = new URL(response.url)
	const withAny = icons.filter((i) => (i.purpose ?? 'any').toLowerCase().includes('any'))
	const pool = withAny.length > 0 ? withAny : icons
	return pool
		.map((i) => ({src: i.src, size: parseSize(i.sizes)}))
		.sort((a, b) => b.size - a.size)
		.map((i) => resolve(i.src, base))
		.find(Boolean)
}

async function probeAppleTouchIcon(base: URL) {
	const response = await doFetch(new URL('/apple-touch-icon.png', base), 'image/*,*/*;q=0.8')
	if (!response) return undefined
	const ct = response.headers.get('content-type') ?? ''
	response.body?.resume()
	if (!ct.includes('image')) return undefined
	return response.url
}

async function fetchFavicon(base: URL) {
	const response = await doFetch(new URL('/favicon.ico', base), 'image/*,*/*;q=0.8')
	if (!response) return undefined
	const ct = response.headers.get('content-type') ?? ''
	response.body?.resume()
	if (!ct.includes('image')) return undefined
	return response.url
}

async function doFetch(url: URL, accept: string) {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
	try {
		const response = await fetch(url, {
			headers: {
				Accept: accept,
				'User-Agent':
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
			},
			signal: controller.signal,
			agent: url.protocol === 'https:' ? agent : undefined,
		})
		if (!response.ok) {
			response.body?.resume()
			return undefined
		}
		return response
	} catch {
		return undefined
	} finally {
		clearTimeout(timeout)
	}
}

function parseSize(sizes: string | undefined) {
	if (!sizes) return 0
	if (sizes.includes('any')) return Infinity
	return parseInt(sizes) || 0
}

function resolve(href: string | undefined, base: URL) {
	try {
		return href ? new URL(href, base).href : undefined
	} catch {
		return undefined
	}
}
