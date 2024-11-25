import i18next from 'i18next'
import prettyBytes from 'pretty-bytes'

import {LOADING_DASH} from '@/constants'

export function maybePrettyBytes(n: number | undefined | null) {
	if (n === null) return LOADING_DASH
	if (n === undefined) return LOADING_DASH
	// TODO: pass in locale
	return prettyBytes(n, {locale: i18next.language})
}
