import i18next from 'i18next'
import prettyBytes from 'pretty-bytes'

import {UNKNOWN} from '@/constants'

export function maybePrettyBytes(n: number | undefined | null) {
	if (n === null) return UNKNOWN()
	if (n === undefined) return UNKNOWN()
	// TODO: pass in locale
	return prettyBytes(n, {locale: i18next.language})
}
