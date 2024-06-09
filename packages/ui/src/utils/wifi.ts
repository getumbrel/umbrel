export function signalToBars(signal: number) {
	const bars = Math.ceil(signal / 25)
	return bars
}
