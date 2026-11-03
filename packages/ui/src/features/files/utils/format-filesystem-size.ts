import prettyBytes from 'pretty-bytes'

import {roundForPrettyBytes} from '@/utils/round-for-pretty-bytes'

export function formatFilesystemSize(size: number | undefined | null): string {
	if (size == null) return '-'
	if (size === 0) return '0 KB'
	return prettyBytes(roundForPrettyBytes(size)).replace('kB', 'KB') // prettyBytes returns 'kB' instead of 'KB': https://github.com/sindresorhus/pretty-bytes?tab=readme-ov-file#why-kb-and-not-kb
}
