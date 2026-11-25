// A point in a video or recording, as a player shows it: 0:07, 1:23, 1:02:03
export function formatMoment(ms: number) {
	const total = Math.max(0, Math.floor(ms / 1000))
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const seconds = String(total % 60).padStart(2, '0')
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

// The folders a file sits in, nearest last, for a one-line "where it is":
// "/Home/Documents/Taxes/2025/ikea.pdf" → ['Home', 'Documents', 'Taxes', '2025'].
// Deep paths keep their nearest three folders; `clipped` says some were dropped.
export function folderTrail(path: string) {
	const folders = path.split('/').filter(Boolean).slice(0, -1)
	return {folders: folders.slice(-3), clipped: folders.length > 3}
}
