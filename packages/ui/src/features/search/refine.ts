// Whether `next` is `previous` being refined rather than replaced: one of
// them holds every word of the other, the last possibly half typed ("sun" →
// "sunset" → "sunset beach", and back). Only then may the previous answer
// stand in while the next is fetched: under a different question it would
// simply be the wrong results, and Enter would open one of them.
export function refinesQuery(previous: string, next: string) {
	const before = words(previous)
	const after = words(next)
	if (before.length === 0 || after.length === 0) return false
	const [fewer, more] = before.length <= after.length ? [before, after] : [after, before]
	return fewer.every((word) => more.some((other) => other.startsWith(word) || word.startsWith(other)))
}

// A word put in quotes ("dad", or "new york" with a quote at either end of
// it) is the same word looked for another way. A word of nothing but quotes
// stays one: there is still a question.
const words = (query: string) =>
	query
		.toLocaleLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => word.replace(/^"+|"+$/g, '') || word)
