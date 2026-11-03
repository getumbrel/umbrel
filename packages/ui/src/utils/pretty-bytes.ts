import prettyBytes from 'pretty-bytes'

import {LOADING_DASH} from '@/constants'
import {roundForPrettyBytes} from '@/utils/round-for-pretty-bytes'

export function maybePrettyBytes(n: number | undefined | null, locale?: string) {
	if (n === null) return LOADING_DASH
	if (n === undefined) return LOADING_DASH
	return prettyBytes(roundForPrettyBytes(n), {locale: locale})
}
