const RADIANS = Math.PI / 180
const DAY_MS = 86_400_000
// Noon on 1 January 2000, the moment the sky's positions are counted from, in days since 1970
const EPOCH_2000 = 10_957.5

// How far the sky has turned over Greenwich at a moment, in degrees: its
// sidereal time
export function skyTurn(time: number) {
	const days = time / DAY_MS - EPOCH_2000
	return (((280.46061837 + 360.98564736629 * days) % 360) + 360) % 360
}

// Where the sun is straight overhead at a moment — the middle of the day
// side — from the Astronomical Almanac's short formulas, good to a hundredth
// of a degree for a century either side of 2000
export function sunOverhead(time: number) {
	const days = time / DAY_MS - EPOCH_2000
	const meanAnomaly = (357.528 + 0.9856003 * days) * RADIANS
	const longitude =
		(280.46 + 0.9856474 * days + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * RADIANS
	const tilt = (23.439 - 0.0000004 * days) * RADIANS
	const ascension = Math.atan2(Math.cos(tilt) * Math.sin(longitude), Math.cos(longitude)) / RADIANS
	const lat = Math.asin(Math.sin(tilt) * Math.sin(longitude)) / RADIANS
	// It is overhead where its place in the sky is on the meridian
	const lng = ((((ascension - skyTurn(time)) % 360) + 540) % 360) - 180
	return {lng, lat}
}

// Where the moon is straight overhead at a moment, from the Almanac's short
// series for it: good to a third of a degree, which on a moon half a degree
// across is where it is
export function moonOverhead(time: number) {
	const centuries = (time / DAY_MS - EPOCH_2000) / 36_525
	const sine = (degrees: number, rate: number) => Math.sin((degrees + rate * centuries) * RADIANS)
	const longitude =
		(218.32 +
			481_267.881 * centuries +
			6.29 * sine(135, 477_198.87) -
			1.27 * sine(259.3, -413_335.36) +
			0.66 * sine(235.7, 890_534.22) +
			0.21 * sine(269.9, 954_397.74) -
			0.19 * sine(357.5, 35_999.05) -
			0.11 * sine(186.5, 966_404.03)) *
		RADIANS
	const latitude =
		(5.13 * sine(93.3, 483_202.02) +
			0.28 * sine(228.2, 960_400.89) -
			0.28 * sine(318.3, 6_003.15) -
			0.17 * sine(217.6, -407_332.21)) *
		RADIANS
	const tilt = (23.439 - 0.013 * centuries) * RADIANS
	// From the ecliptic, which the moon keeps near, to the Earth's own equator
	const [x, y, z] = [
		Math.cos(latitude) * Math.cos(longitude),
		Math.cos(latitude) * Math.sin(longitude),
		Math.sin(latitude),
	]
	const ascension = Math.atan2(y * Math.cos(tilt) - z * Math.sin(tilt), x) / RADIANS
	const lat = Math.asin(y * Math.sin(tilt) + z * Math.cos(tilt)) / RADIANS
	const lng = ((((ascension - skyTurn(time)) % 360) + 540) % 360) - 180
	return {lng, lat}
}

// A place as a direction out from the middle of the Earth
export function direction(lng: number, lat: number): [number, number, number] {
	const [longitude, latitude] = [lng * RADIANS, lat * RADIANS]
	return [Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)]
}
