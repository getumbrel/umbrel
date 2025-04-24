export function secondsToEta(seconds: number | null | undefined): string {
	if (seconds == null || seconds <= 0 || !Number.isFinite(seconds)) {
		return '-'
	}

	if (seconds < 60) {
		return `${Math.round(seconds)}s`
	}

	if (seconds < 3600) {
		return `${Math.round(seconds / 60)}m`
	}

	const hours = Math.floor(seconds / 3600)
	const minutes = Math.round((seconds % 3600) / 60)
	return `${hours}hr ${minutes}m`
}
