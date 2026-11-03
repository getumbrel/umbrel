import {readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'

// Builds the stars the Photos map's globe hangs among: every star the eye can
// see (to magnitude 6.5), where it is, how bright, and what colour.
// Source: the Yale Bright Star Catalogue, 5th revised edition (Hoffleit &
// Warren 1991), as distributed by the CDS, catalogue V/50:
// https://cdsarc.cds.unistra.fr/ftp/cats/V/50/
//
// Usage:
//   node scripts/build-photos-stars.mjs /path/to/V_50/catalog
//
// Six bytes a star, little-endian, brightest first: right ascension (uint16
// over the 24 hours), declination (int16 over ±90°), magnitude (uint8:
// (V + 2) × 30) and colour (uint8: (B−V + 0.5) × 100). Positions are J2000.

const source = process.argv[2]
if (!source) throw new Error('Pass the path to the Bright Star Catalogue file')
const output = path.resolve('public/assets/photos/stars-v1.bin')

// The catalogue's fixed columns, counted from 1 as its ReadMe does
const field = (line, from, to) => line.slice(from - 1, to).trim()
const stars = (await readFile(source, 'latin1'))
	.split('\n')
	// A few entries are novae and clusters that were given a number and no place
	.filter((line) => field(line, 76, 77) !== '')
	.map((line) => ({
		hours: Number(field(line, 76, 77)) + Number(field(line, 78, 79)) / 60 + Number(field(line, 80, 83)) / 3600,
		degrees:
			(field(line, 84, 84) === '-' ? -1 : 1) *
			(Number(field(line, 85, 86)) + Number(field(line, 87, 88)) / 60 + Number(field(line, 89, 90)) / 3600),
		magnitude: Number(field(line, 103, 107)),
		// Unmeasured for a few: taken to be the Sun's
		colour: field(line, 110, 114) === '' ? 0.65 : Number(field(line, 110, 114)),
	}))
	.filter(({hours, degrees, magnitude}) => [hours, degrees, magnitude].every(Number.isFinite))
	.sort((a, b) => a.magnitude - b.magnitude)

const byte = (value) => Math.max(0, Math.min(255, Math.round(value)))
const packed = Buffer.alloc(stars.length * 6)
stars.forEach(({hours, degrees, magnitude, colour}, index) => {
	packed.writeUInt16LE(Math.round((hours / 24) * 65535) % 65536, index * 6)
	packed.writeInt16LE(Math.round((degrees / 90) * 32767), index * 6 + 2)
	packed.writeUInt8(byte((magnitude + 2) * 30), index * 6 + 4)
	packed.writeUInt8(byte((colour + 0.5) * 100), index * 6 + 5)
})
await writeFile(output, packed)
console.log(`${stars.length} stars, ${packed.length} bytes → ${output}`)
