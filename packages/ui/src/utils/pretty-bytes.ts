import prettyBytes from 'pretty-bytes'

import {LOADING_DASH} from '@/constants'

export function maybePrettyBytes(n: number | undefined | null, locale?: string) {
	if (n === null) return LOADING_DASH
	if (n === undefined) return LOADING_DASH
	return prettyBytes(n, {locale: locale})
}
