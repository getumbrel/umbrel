// Hyperlinks a file names open only what can't run code or reach local resources: web pages and mail. The URL is
// parsed rather than matched, so what opens is exactly what was checked.
export function safeHref(target: string | undefined): string | undefined {
	if (!target) return undefined
	try {
		const url = new URL(target.trim())
		return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' ? url.href : undefined
	} catch {
		return undefined
	}
}
