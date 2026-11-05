// The characters as a reader sees them, each one whole: an emoji, a flag or a
// letter with a combining accent spans several code points, and cutting one
// apart draws a replacement glyph or turns a family emoji into a couple
const segmenter = 'Segmenter' in Intl ? new Intl.Segmenter() : undefined

export function splitCharacters(text: string) {
	if (!segmenter) return Array.from(text)
	return Array.from(segmenter.segment(text), ({segment}) => segment)
}

export function firstCharacter(text: string) {
	return splitCharacters(text)[0] ?? ''
}
