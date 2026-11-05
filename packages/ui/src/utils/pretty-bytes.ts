import prettyBytes from 'pretty-bytes'

import {LOADING_DASH} from '@/constants'
import {roundForPrettyBytes} from '@/utils/round-for-pretty-bytes'

// The locale is required, so a caller can't fall back to English by omission
export function maybePrettyBytes(n: number | undefined | null, locale: string) {
	if (n === null) return LOADING_DASH
	if (n === undefined) return LOADING_DASH
	return prettyBytes(roundForPrettyBytes(n), {locale})
}
