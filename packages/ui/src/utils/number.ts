import i18next from 'i18next'

export function formatNumberI18n({n, showDecimals = true}: {n: number; showDecimals?: boolean}) {
	return new Intl.NumberFormat(i18next.language || 'en-US', {
		minimumFractionDigits: showDecimals ? 2 : 0,
		maximumFractionDigits: showDecimals ? 2 : 0,
	}).format(n)
}
