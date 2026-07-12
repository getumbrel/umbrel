export type WebdavVendor = 'other' | 'nextcloud'

export function detectWebdavVendor(url: string): WebdavVendor {
	const normalized = url.toLowerCase()
	if (normalized.includes('nextcloud') || normalized.includes('/remote.php/dav')) {
		return 'nextcloud'
	}
	return 'other'
}
