import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {t} from '@/utils/i18n'
import type {SupportedLanguageCode} from '@/utils/language'

export function getSnapshotDateLabel(
	id: string,
	backups: {id: string; time: number}[],
	lang: SupportedLanguageCode,
): string {
	if (id === 'current') return t('rewind.now')
	const found = backups.find((b) => b.id === id)
	if (!found) return ''
	return formatFilesystemDate(found.time, lang)
}
