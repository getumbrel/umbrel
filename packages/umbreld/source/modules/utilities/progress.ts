// Progress percentages are reported in 0.1% steps. Whole percents are too coarse for
// long operations, a bar or ring visibly jumps each time one ticks over, while 0.1% is
// already less than a pixel on any progress element we render. Logs should stick to
// whole percents so a long operation doesn't write a thousand lines.
export function floorToTenthPercent(percent: number) {
	return Math.floor(percent * 10) / 10
}
