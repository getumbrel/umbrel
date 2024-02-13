import {useEffect} from 'react'

import {t} from '@/utils/i18n'

export function useUmbrelTitle(title?: string | false) {
	useEffect(() => {
		// Allow hook to do nothing if no title provided
		if (!title) return

		const prevTitle = document.title
		document.title = t('page-title-umbrel', {title})
		return () => {
			document.title = prevTitle
		}
	}, [title])
}
