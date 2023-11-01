import prettyBytes from 'pretty-bytes'

import {UNKNOWN} from '@/constants'

export function maybePrettyBytes(n: number | undefined | null) {
	if (n === null) return UNKNOWN()
	if (n === undefined) return UNKNOWN()
	return prettyBytes(n)
}
