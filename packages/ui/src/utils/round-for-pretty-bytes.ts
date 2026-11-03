// pretty-bytes picks the unit before it rounds, so 999.5 GB and up comes out
// as "1,000 GB". When rounding to the 3 significant digits it shows would
// carry into the next unit, hand it the rounded value so it says "1 TB".
// Any other value is passed through, so it's only ever rounded once.
const unitOf = (n: number) => Math.floor(Math.log10(Math.abs(n)) / 3)
export function roundForPrettyBytes(n: number) {
	const rounded = Number(n.toPrecision(3))
	return unitOf(rounded) > unitOf(n) ? rounded : n
}
