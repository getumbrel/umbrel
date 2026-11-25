import {join} from 'node:path'

import type express from 'express'

export const PRIVATE_IMMUTABLE_CACHE_CONTROL = 'private, max-age=31536000, immutable'
export const PUBLIC_IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

// The build's own files carry a hash of their contents in their filenames and live
// in assets/build, so they can be cached for good, as can an asset linked with its
// hash in the URL, as wallpapers are with `?v=<hash>`. Everything else copied from
// the UI's public/ directory keeps its name when it changes, so it revalidates with
// its ETag and Last-Modified, and an OTA update reaches it.
export function uiStaticOptions(uiPath: string) {
	const assetsPath = join(uiPath, 'assets/')
	const buildPath = join(assetsPath, 'build/')
	return {
		cacheControl: true,
		etag: true,
		lastModified: true,
		maxAge: 0,
		setHeaders: (response: express.Response, filePath: string) => {
			const isVersioned = filePath.startsWith(assetsPath) && response.req.query.v !== undefined
			if (filePath.startsWith(buildPath) || isVersioned) response.set('Cache-Control', PUBLIC_IMMUTABLE_CACHE_CONTROL)
		},
	}
}
