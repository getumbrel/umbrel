// What is said in Hindi is written down in the Latin letters its speakers
// type it in (see romanise.py in packages/os), and nobody spells Hindi in
// Latin letters the same way twice: "kahaan", "kahan" and "kahn" are one
// word, as are "hai", "hay" and "h". So speech kept that way is also found by
// how a word sounds: its consonants in order, an aspirate as its plain
// consonant, with a vowel only where it starts the word and a nasal ending
// as none ("nahin" and "nahi"). The rule is the one an earlier version of
// search settled on: on Hindi transcripts, 88% of the words of queries typed
// as people type them matched a word said that way, against 40% spelt as
// the model spells them.

// Spellings of one sound, the first as the second
const ALIKE = [
	...[
		['ee', 'i'],
		['oo', 'u'],
		['w', 'v'],
		['z', 'j'],
	],
	...[
		['ph', 'f'],
		['q', 'k'],
		['x', 'ks'],
		['y', 'i'],
	],
]

// How a word sounds, or nothing for one that is not all Latin letters
export function soundOf(word: string) {
	let sound = word.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
	if (!/^[a-z]+$/.test(sound)) return ''
	for (const [spelling, as] of ALIKE) sound = sound.replaceAll(spelling, as)
	sound = sound
		.replace(/(.)\1+/g, '$1')
		.replace(/([bcdgjkpt])h/g, '$1')
		.replace(/(?<=[iue])n$/, '')
	return sound[0] + sound.slice(1).replace(/[aeiouh]/g, '')
}

// Each word of a text with how it sounds and where it is
export function soundsIn(text: string) {
	return [...text.matchAll(/[\p{L}\p{N}]+/gu)].flatMap(({0: word, index}) => {
		const sound = soundOf(word)
		return sound ? [{sound, from: index, to: index + word.length}] : []
	})
}
