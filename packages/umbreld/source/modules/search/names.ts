import {foldName} from '../files/places.ts'

// Files' own search finds a file by its name, and is generous about what
// resembles one: "sample" brings back a folder called "Samooeng". Here that
// is sorted into what a search by content can stand beside:
//
//   exact  the name has every word that was typed
//   near   it has every word but for a slip of the fingers ("sampel" for
//          a file called "SampleDoc")
//
// and what only looks a little like what was typed is left out.

const WORDS = /[\p{L}\p{N}]+/gu

// Compared without case, accents or punctuation
const fold = foldName

// How many slips a word of this length is allowed: none in a short one, where
// one letter is most of the word
const allowedSlips = (word: string) => (word.length < 4 ? 0 : word.length < 8 ? 1 : 2)

// How many slips of the fingers lie between two words: a letter left out, one
// too many, a wrong one, or two swapped
function slips(first: string, second: string) {
	let before: number[] = []
	let row = Array.from({length: second.length + 1}, (_, index) => index)
	for (let i = 1; i <= first.length; i++) {
		const next = [i]
		for (let j = 1; j <= second.length; j++) {
			const same = first[i - 1] === second[j - 1]
			next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (same ? 0 : 1))
			if (i > 1 && j > 1 && first[i - 1] === second[j - 2] && first[i - 2] === second[j - 1]) {
				next[j] = Math.min(next[j], before[j - 2] + 1)
			}
		}
		before = row
		row = next
	}
	return row[second.length]
}

// Whether a word is another but for a slip of the fingers. Two words are at
// least as many slips apart as one is longer than the other, so one that much
// longer is not gone through letter by letter.
const slipped = (word: string, other: string) =>
	Math.abs(word.length - other.length) <= allowedSlips(word) && slips(word, other) <= allowedSlips(word)

export function nameMatches<T extends {name: string}>(text: string, files: T[]) {
	const typed = fold(text).match(WORDS) ?? []
	const exact: T[] = []
	const near: T[] = []
	for (const file of files) {
		const name = fold(file.name)
		if (typed.every((word) => name.includes(word))) {
			exact.push(file)
			continue
		}
		const words = name.match(WORDS) ?? []
		// A word typed is often only the start of the one in the name
		const within = (word: string) =>
			words.some((other) =>
				[other, other.slice(0, word.length), other.slice(0, word.length + 1)].some((part) => slipped(word, part)),
			)
		if (typed.length > 0 && typed.every((word) => name.includes(word) || within(word))) near.push(file)
	}
	return {exact, near}
}

// How sure a name makes it that its file is what was meant, from 0 to 1 (see
// hits.ts for what stands beside it): 1 when the name is what was typed, and
// for a name that has every word typed as a word of its own, more the more
// of the name they are ("car.jpg" over "car insurance 2024.pdf" for "car").
// A name that only has them as the start of a word, or inside one, is a
// weaker reason. Nothing for a name that has none of that.
//
// A name that has the words but for a slip of the fingers is held at NEARLY
// of what it would be with them typed right: "minuets" is most of the way to
// a file called "minutes", and a little of the way to "minutes of the March
// meeting". One that only looks like what was typed some other way is NEAR.
const WHOLE = 0.55
const STARTS = 0.4
const WITHIN = 0.3
const NEARLY = 0.6
export const NEAR = 0.3
// Photos also finds a photo by what its camera wrote about it, and every
// photo from a phone has the phone's maker written on it
export const NOTED = 0.2

export function nameStrength(text: string, name: string, slip = false) {
	const typed = fold(text).match(WORDS) ?? []
	if (typed.length === 0) return 0
	// Without what kind of file it is
	const words: string[] = fold(name.replace(/\.[^.\s]{1,8}$/, '')).match(WORDS) ?? []
	// With `slip`, a word is the one typed when it is that but for a slip of the fingers
	const is = (word: string, other: string) => word === other || (slip && slipped(word, other))
	if (slip) {
		const whole = typed.length === words.length && typed.every((word, index) => is(word, words[index]!))
		const every = typed.every((word) => words.some((other) => is(word, other)))
		if (!whole && !every) return NEAR
		const share = Math.min(1, typed.join('').length / (words.join('').length || 1))
		return NEARLY * (whole ? 1 : WHOLE + (0.95 - WHOLE) * share)
	}
	if (words.join(' ') === typed.join(' ')) return 1
	if (typed.every((word) => words.includes(word))) {
		return WHOLE + (0.95 - WHOLE) * Math.min(1, typed.join('').length / (words.join('').length || 1))
	}
	if (typed.every((word) => words.some((other) => other.startsWith(word)))) return STARTS
	if (typed.every((word) => words.some((other) => other.includes(word)))) return WITHIN
	return 0
}
