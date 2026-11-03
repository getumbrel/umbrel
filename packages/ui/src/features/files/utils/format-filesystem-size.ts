import i18next from 'i18next'
import prettyBytes from 'pretty-bytes'

import {roundForPrettyBytes} from '@/utils/round-for-pretty-bytes'

// Numbers follow the UI language ("2,5 MB" in German); units stay as they are
export function formatFilesystemSize(size: number | undefined | null): string {
	if (size == null) return '-'
	if (size === 0) return '0 KB'
	return prettyBytes(roundForPrettyBytes(size), {locale: i18next.language}).replace('kB', 'KB') // prettyBytes returns 'kB' instead of 'KB': https://github.com/sindresorhus/pretty-bytes?tab=readme-ov-file#why-kb-and-not-kb
}
