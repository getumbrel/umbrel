import i18next from 'i18next'

// A time left, short, in the UI language: "45 sec", "12 min" and "1 hr, 30 min"
// in English, "12 Min." in German, "1시간 30분" in Korean. Short units and list,
// as Intl.DurationFormat's short style writes them; narrow ones are cryptic in
// many languages (Ukrainian "12х", Turkish "2s" for two hours).
//
// compact is for the tight spots in the upload and transfer islands, where the
// time sits beside a name or a speed: past an hour it shows the hours alone
// ("2 hr"), since "1 godz. i 30 min" would leave a name only a few letters.
export function secondsToEta(seconds: number | null | undefined, {compact = false}: {compact?: boolean} = {}): string {
	if (seconds == null || seconds <= 0 || !Number.isFinite(seconds)) {
		return '-'
	}

	const language = i18next.language
	const unit = (value: number, name: 'second' | 'minute' | 'hour') =>
		new Intl.NumberFormat(language, {style: 'unit', unit: name, unitDisplay: 'short'}).format(value)

	// Rounded once, so 59.6 seconds reads "1 min" rather than "60 sec"
	if (Math.round(seconds) < 60) return unit(Math.round(seconds), 'second')
	const totalMinutes = Math.round(seconds / 60)
	if (totalMinutes < 60) return unit(totalMinutes, 'minute')

	if (compact) return unit(Math.round(totalMinutes / 60), 'hour')

	const hours = Math.floor(totalMinutes / 60)
	const minutes = totalMinutes % 60
	if (minutes === 0) return unit(hours, 'hour')
	return new Intl.ListFormat(language, {type: 'unit', style: 'short'}).format([
		unit(hours, 'hour'),
		unit(minutes, 'minute'),
	])
}
