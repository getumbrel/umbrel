import i18next from 'i18next'

export function formatNumberI18n(n: number, locale: string = 'en-US') {
	return new Intl.NumberFormat(locale || i18next.language, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(n)
}
