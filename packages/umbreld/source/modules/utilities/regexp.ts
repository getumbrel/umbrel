// Escape special RegExp literals
export function escapeSpecialRegExpLiterals(string: string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
