// Chinese, Japanese and Thai are written without spaces between words, and
// Korean joins a word to what follows it ("서울에서", in Seoul). An index of
// words sees "去年在北京拍的照片" as one word, so "北京" is not found in it.
// Without a dictionary of each language there is no telling where a word
// ends, so text in these scripts is also kept as every pair of neighbouring
// characters: "北京" is then in any text that has those two side by side, and
// a longer word is in a text that has each of its pairs, one after another.

// Han, the kana with the mark that lengthens a vowel in katakana ("タワー"),
// Hangul and Thai
export const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}ー]/u
const WORDS = /[\p{L}\p{N}\p{M}ー]+/gu

// As text is compared: characters in their common form ("ｶ" as "カ"), without case
const fold = (text: string) => text.normalize('NFKC').toLowerCase()

// A character as the index keeps it: the same length whatever it is, and
// nothing a tokenizer has an opinion about
const token = (characters: string[]) =>
	characters.map((character) => `x${character.codePointAt(0)!.toString(16).padStart(6, '0')}`).join('')

// The runs of a text that have something of these scripts in them, with the
// digits and other letters written up against it ("2024年", "T恤"): the index
// of words holds each as one word, whatever is in it
const runs = (text: string) => (fold(text).match(WORDS) ?? []).filter((word) => UNSPACED.test(word))

// What the index keeps of a text: for each such run every pair of
// neighbouring characters, and its last character on its own. A character
// begins a pair unless it ends its run, so with that a single character is
// found wherever it is. Nothing where the text has none of these scripts.
export function pairs(text: string) {
	const kept: string[] = []
	for (const run of runs(text)) {
		const characters = [...run]
		for (let index = 0; index < characters.length - 1; index++) kept.push(token(characters.slice(index, index + 2)))
		kept.push(token(characters.slice(-1)))
	}
	return kept.join(' ')
}

// What was typed, as the two indexes are asked for it: `words` for the index
// of words, and `runs` for this one, each a query that finds a run wherever
// it is in a text. `terms` are all of them as typed, for finding them again
// in what was found.
export function typed(text: string) {
	const terms = fold(text).match(WORDS) ?? []
	return {
		words: terms.filter((word) => !UNSPACED.test(word)),
		runs: runs(text).map((run) => {
			const characters = [...run]
			return characters.length === 1
				? `${token(characters)}*`
				: `"${characters
						.slice(0, -1)
						.map((_, index) => token(characters.slice(index, index + 2)))
						.join(' ')}"`
		}),
		terms,
	}
}
