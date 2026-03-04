// Utilities for mapping between UI-visible virtual paths and the resolved
// virtual paths used by the backend. We do a simple root-prefix
// replacement based on a small alias map.

export type PathAliases = Record<string, string> | undefined

// Replace a leading prefix in a path. Matches exact or prefix-with-slash.
// Returns the original path when there is no match.
export function replaceLeadingPrefix(path: string, prefix: string, replacement: string): string {
	if (path === prefix) return replacement
	if (path.startsWith(prefix + '/')) return replacement + path.slice(prefix.length)
	return path
}

// Map UI path → virtual path using the alias map, e.g. { "/Home": "/Backups/<dir>/Home" }.
export function uiToVirtualPath(path: string, aliases: PathAliases): string {
	if (!aliases) return path
	for (const [from, to] of Object.entries(aliases)) {
		if (path === from || path.startsWith(from + '/')) {
			return replaceLeadingPrefix(path, from, to)
		}
	}
	return path
}

// Map virtual → UI by swapping the matched virtual root back to its UI root.
export function virtualToUiPath(path: string, aliases: PathAliases): string {
	if (!aliases) return path
	for (const [uiRoot, virtualRoot] of Object.entries(aliases)) {
		if (path === virtualRoot || path.startsWith(virtualRoot + '/')) {
			return replaceLeadingPrefix(path, virtualRoot, uiRoot)
		}
	}
	return path
}
