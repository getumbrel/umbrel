// TODO: this is mostly just a placeholder for now.
// We need to implement this robustly. Look into css truncation.
import type {FileSystemItem} from '@/features/files/types'
import {splitCharacters} from '@/utils/characters'

// Formats file/folder names for display, including truncation
export function formatItemName({name, maxLength = 30}: {name: FileSystemItem['name']; maxLength?: number}) {
	// For files, handle name and extension separately
	const {name: fileName, extension} = splitFileName(name)

	// Account for extension length when truncating so that truncated files with extensions vs no extensions have the same length
	const nameMaxLength = extension ? maxLength - textWidth(extension) : maxLength
	const truncatedName = truncateName(fileName, nameMaxLength)
	return extension ? `${truncatedName}${extension}` : truncatedName
}

// Splits a filename into its name and extension parts
// Example: "document.pdf" -> { name: "document", extension: ".pdf" }
// Handles edge cases:
// - Hidden files (.gitignore) -> { name: ".gitignore", extension: null }
// - Multiple dots (file.name.txt) -> { name: "file.name", extension: ".txt" }
// - No extension (README) -> { name: "README", extension: null }
// - .tar.* extensions (file.tar.gz, file.tar.bz2, etc) -> { name: "file", extension: ".tar.gz" }
export function splitFileName(fileName: string): {name: string; extension: string | null} {
	// Handle .tar.* compound extensions first
	const compoundMatch = fileName.match(/^(.+?)(\.tar\.[^./]+)$/)
	if (compoundMatch) {
		const [, name, extension] = compoundMatch
		return {name, extension}
	}

	// Handle regular files
	const matches = fileName.match(/^([^/]*?)(?:(\.[^./]+))?$/)

	if (!matches) {
		return {name: fileName, extension: null}
	}

	const [, name, extension] = matches
	return {
		name,
		extension: extension || null,
	}
}

// Chinese, Japanese and Korean characters, fullwidth forms and emoji are about
// twice as wide as Latin letters, so they count double. Otherwise a 30-character
// Japanese name still fills four lines of an icon label, and the label's own
// clamp cuts off its end, extension and all.
const WIDE_CHARACTER =
	/[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]|\p{Emoji_Presentation}|\uFE0F/u

function characterWidth(character: string) {
	return WIDE_CHARACTER.test(character) ? 2 : 1
}

function textWidth(text: string) {
	let width = 0
	for (const character of splitCharacters(text)) width += characterWidth(character)
	return width
}

// How many characters from the start of `characters` fit in `width`
function countFitting(characters: string[], width: number) {
	let used = 0
	let count = 0
	for (const character of characters) {
		used += characterWidth(character)
		if (used > width) break
		count++
	}
	return count
}

// Truncates a name while preserving meaningful parts
// Example: "very-long-document-name" -> "very-long…name"
function truncateName(name: string, maxLength: number): string {
	if (textWidth(name) <= maxLength) return name

	// Reserve 1 character for the ellipsis, and keep at least the first one
	const availableLength = Math.max(maxLength - 1, 1)
	const startLength = Math.ceil(availableLength * 0.6) // Keep more characters at start
	const endLength = availableLength - startLength // Keep remaining at end

	const characters = splitCharacters(name)
	const start = characters.slice(0, countFitting(characters, startLength))
	const end = characters.slice(characters.length - countFitting([...characters].reverse(), endLength))

	return `${start.join('')}…${end.join('')}`
}
