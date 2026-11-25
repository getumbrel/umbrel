import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'

// Where a photo or video was taken, by name: the city it was in or near, the
// region and the country. The names come from a table of the world's cities,
// towns and villages of more than five thousand people, with what each is
// called in the languages umbrelOS speaks (places.tsv.gz, built by
// scripts/build-places from GeoNames, geonames.org, CC BY 4.0). The table is
// part of umbreld: where a photo was taken is never sent anywhere to be named.
//
// A place is kept as what GeoNames calls it: a city by its number, a region
// by its code ('TH.40') and a country by its code ('TH'). Search names one of
// the three as 'g:1609350', 'r:TH.40' or 'c:TH'.
export type Place = {city?: number; region?: string; country: string}

// A photo is in a city when it was taken this close to it, and still in that
// city's region up to the second distance. Further than that from anywhere
// (open sea, wilderness) it is nowhere that has a name.
const CITY_KM = 50
const REGION_KM = 250
const KM_A_DEGREE = 111.2

// What people type for a few countries, which is not what they are called
const ALSO_CALLED: Record<string, string[]> = {
	US: ['usa', 'america', 'united states of america'],
	GB: ['britain', 'great britain', 'england', 'scotland', 'wales'],
	AE: ['uae', 'emirates'],
	NL: ['holland'],
	CZ: ['czech republic'],
	KR: ['korea'],
}

// As names are compared: without case, punctuation or the accents of the
// scripts that have them. The marks of other scripts make other letters
// ("バ" is not "ハ").
export const foldName = (name: string) =>
	name
		.normalize('NFKD')
		.replace(/(?<=[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]\p{M}*)\p{M}/gu, '')
		.normalize('NFC')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()

class Places {
	// The table, and where each city's line starts in it. There are sixty
	// thousand cities, so one is not an object: it is its position in these.
	#table: Buffer
	#lines: Uint32Array
	#ids: Uint32Array
	#latitudes: Float32Array
	#longitudes: Float32Array
	// How far from its middle a city still is the city, in km
	#reaches: Float32Array
	// Countries and regions by code, each as its name and its other names
	#areas = new Map<string, string[]>()
	// The cities in each square of a degree a side
	#squares = new Map<number, number[]>()

	constructor() {
		this.#table = gunzipSync(readFileSync(new URL('./places.tsv.gz', import.meta.url)))
		const cities: number[] = []
		for (let start = 0; start < this.#table.length; ) {
			let end = this.#table.indexOf('\n', start)
			if (end === -1) end = this.#table.length
			if (this.#table[start] === 0x67) cities.push(start)
			else {
				const [, code, ...names] = this.#table.toString('utf8', start, end).split('\t')
				this.#areas.set(code, names)
			}
			start = end + 1
		}
		this.#lines = Uint32Array.from(cities)
		this.#ids = new Uint32Array(cities.length)
		this.#latitudes = new Float32Array(cities.length)
		this.#longitudes = new Float32Array(cities.length)
		this.#reaches = new Float32Array(cities.length)
		for (let city = 0; city < cities.length; city++) {
			const [, id, , latitude, longitude, , population] = this.#fields(city)
			this.#ids[city] = Number(id)
			this.#latitudes[city] = Number(latitude)
			this.#longitudes[city] = Number(longitude)
			// A city of a million people is ten kilometres from its middle to its edge
			this.#reaches[city] = Math.sqrt(Number(population)) / 100
			const square = squareOf(this.#latitudes[city], this.#longitudes[city])
			const there = this.#squares.get(square)
			if (there) there.push(city)
			else this.#squares.set(square, [city])
		}
	}

	#fields(city: number) {
		const end = this.#table.indexOf('\n', this.#lines[city])
		return this.#table.toString('utf8', this.#lines[city], end === -1 ? this.#table.length : end).split('\t')
	}

	// Which city has this number
	#city(id: number) {
		let [low, high] = [0, this.#ids.length - 1]
		while (low <= high) {
			const middle = (low + high) >> 1
			if (this.#ids[middle] === id) return middle
			if (this.#ids[middle] < id) low = middle + 1
			else high = middle - 1
		}
	}

	// The place a point on the earth is in
	at(latitude: number, longitude: number): Place | undefined {
		// A degree of longitude is less far the nearer the poles
		const shrink = Math.max(Math.cos((latitude * Math.PI) / 180), 0.05)
		const north = Math.ceil(REGION_KM / KM_A_DEGREE)
		const east = Math.min(180, Math.ceil(north / shrink))
		let [inside, insideBy] = [-1, CITY_KM]
		let [nearest, away] = [-1, REGION_KM]
		for (let y = -north; y <= north; y++) {
			for (let x = -east; x <= east; x++) {
				for (const city of this.#squares.get(squareOf(latitude + y, longitude + x)) ?? []) {
					const distance =
						Math.hypot(this.#latitudes[city] - latitude, turned(this.#longitudes[city] - longitude) * shrink) *
						KM_A_DEGREE
					if (distance < away) [nearest, away] = [city, distance]
					// From the city's edge, not its middle: a photo taken in Paris is in
					// Paris, and not in the suburb whose middle is nearer
					if (distance < CITY_KM && distance - this.#reaches[city] < insideBy) {
						;[inside, insideBy] = [city, distance - this.#reaches[city]]
					}
				}
			}
		}
		const city = inside === -1 ? nearest : inside
		if (city === -1) return
		const code = this.#fields(city)[5]
		return {
			...(inside === -1 ? {} : {city: this.#ids[city]}),
			...(code.includes('.') ? {region: code} : {}),
			country: code.slice(0, 2),
		}
	}

	// What a place is called, to show it
	name({city, region, country}: Place) {
		const index = city === undefined ? undefined : this.#city(city)
		const names = {
			city: index === undefined ? undefined : this.#fields(index)[2],
			region: region ? this.#areas.get(region)?.[0] : undefined,
			country: this.#areas.get(country)?.[0] ?? country,
		}
		return {
			name: names.city ?? names.region ?? names.country,
			// What is around it, where that says more than its own name does
			...(names.city && names.region ? {region: names.region} : {}),
			country: names.country,
		}
	}

	// Everything that the places given can be called when typed: each city,
	// with the region and country it is in, by the id Search names it by. The
	// widest come first.
	named(places: Place[]) {
		const found = new Map<string, {id: string; label: string; names: string[]}>()
		const add = (id: string, [label, ...others]: string[], also: string[] = []) => {
			if (label && !found.has(id)) {
				found.set(id, {id, label, names: [...new Set([label, ...others, ...also].map(foldName))].filter(Boolean)})
			}
		}
		for (const {country} of places) add(`c:${country}`, this.#areas.get(country) ?? [], ALSO_CALLED[country])
		for (const {region} of places) if (region) add(`r:${region}`, this.#areas.get(region) ?? [])
		for (const {city} of places) {
			const index = city === undefined ? undefined : this.#city(city)
			if (index === undefined) continue
			const [, , name, , , , , ...others] = this.#fields(index)
			add(`g:${city}`, [name, ...others])
		}
		return [...found.values()]
	}
}

// Longitude runs round: 179° east is two degrees from 179° west
const turned = (longitude: number) => ((((longitude + 180) % 360) + 360) % 360) - 180
const squareOf = (latitude: number, longitude: number) =>
	Math.floor(latitude) * 360 + Math.floor(turned(longitude)) + 180

// Read the first time a place is asked for, and kept
let loaded: Places | undefined
export const places = () => (loaded ??= new Places())

// The place that what was typed names, of the ones given (see `named`), with
// what is left to look for once it is taken out: "beach in thailand" is a
// beach, in Thailand. One place, the one with the longest name there: "new
// york city" is the city and not the state. Between names as long, the widest.
export function placeIn(text: string, named: Array<{id: string; label: string; names: string[]}>) {
	const words = text.trim().split(/\s+/)
	const folded = words.map(foldName)
	let found: {id: string; label: string; name: string; from: number; to: number; rest?: string} | undefined
	for (const {id, label, names} of named) {
		for (const name of names) {
			if (name.length <= (found?.name.length ?? 0)) continue
			// Written without spaces, a name is found inside a word: "東京の写真"
			if (UNSPACED.test(name)) {
				const from = name.length > 1 ? folded.findIndex((word) => word.includes(name)) : -1
				if (from !== -1) found = {id, label, name, from, to: from + 1, rest: folded[from].replace(name, ' ').trim()}
				continue
			}
			const count = name.split(' ').length
			for (let from = 0; name.length > 2 && from + count <= words.length; from++) {
				if (folded.slice(from, from + count).join(' ') !== name) continue
				// A name that is far more often a word is a place when what was
				// typed says so: "in nice", and not "nice sunset"
				if (ordinary().has(name) && !LEADING.has(folded[from - 1])) continue
				found = {id, label, name, from, to: from + count}
				break
			}
		}
	}
	if (!found) return
	// The word that led to it goes with it
	const led = LEADING.has(folded[found.from - 1])
	const from = led ? found.from - 1 : found.from
	const left = [...words.slice(0, from), ...(found.rest ? [found.rest] : []), ...words.slice(found.to)]
	return {
		id: found.id,
		label: found.label,
		text: left.join(' '),
		// Which of the words it was read from, whether one led to it, and what
		// else was in the word a name written without spaces was found inside
		words: {from, to: found.to, led, ...(found.rest ? {rest: found.rest} : {})},
	}
}

const UNSPACED = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー ]+$/u
const LEADING = new Set(['in', 'at', 'from', 'near', 'around'])

// Names of places that are far more often only words, in English or another
// of umbrelOS's languages: "nice" and "bath", the Swedish "och" ("and", and
// Osh in Kyrgyzstan), the French "seul" ("alone", and what Spanish calls
// Seoul). Found for an earlier version of search by holding every name in the
// table against the most frequent words of each language.
let words: Set<string> | undefined
const ordinary = () =>
	(words ??= new Set(
		readFileSync(new URL('./places-ordinary-words.txt', import.meta.url), 'utf8')
			.split(/\s+/)
			.map(foldName),
	))

// A place that Search names by id, as the columns of media_metadata it is kept in
export function placeColumn(
	id: string,
): {column: 'place_city' | 'place_region' | 'place_country'; value: string | number} | undefined {
	const value = id.slice(2)
	if (id.startsWith('g:') && /^\d+$/.test(value)) return {column: 'place_city', value: Number(value)}
	if (id.startsWith('r:') && value) return {column: 'place_region', value}
	if (id.startsWith('c:') && value) return {column: 'place_country', value}
}
