// An upload's progress (0 to 100) as a whole percent in the UI language ("37%",
// "37 %" in German), rounded down so it only reads 100% once it's done
export function formatUploadPercent(progress: number, language: string) {
	return new Intl.NumberFormat(language, {style: 'percent', maximumFractionDigits: 0}).format(
		Math.floor(progress) / 100,
	)
}
