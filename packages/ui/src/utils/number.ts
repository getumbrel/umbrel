export function formatNumberI18n({
	n,
	showDecimals = true,
	locale = 'en-US',
}: {
	n: number
	showDecimals?: boolean
	locale?: string
}) {
	return new Intl.NumberFormat(locale, {
		minimumFractionDigits: showDecimals ? 2 : 0,
		maximumFractionDigits: showDecimals ? 2 : 0,
	}).format(n)
}
