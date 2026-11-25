import {useTranslation} from 'react-i18next'

import type {Person} from '@/features/photos/hooks/use-people'
import {useConfirmation} from '@/providers/confirmation/use-confirmation'
import {formatNumberI18n} from '@/utils/number'

// A merge can't be taken back, so every way into one asks first and says who
// survives. Resolves to whether to go ahead; `count` is everyone involved,
// the survivor included. Asked as what can't be undone is asked everywhere:
// the dialog opens on Cancel, so one Enter too many merges nobody.
export function useConfirmMerge() {
	const {t, i18n} = useTranslation()
	const confirm = useConfirmation()
	return (count: number, into: Pick<Person, 'name'>) => {
		const format = (n: number) => formatNumberI18n({n, showDecimals: false, locale: i18n.language})
		return confirm({
			// Into someone with a name, the ones counted are those who join them
			title: into.name
				? t('photos-people.merge-confirm-title-named', {
						count: count - 1,
						formattedCount: format(count - 1),
						name: into.name,
					})
				: t('photos-people.merge-confirm-title', {count, formattedCount: format(count)}),
			message: t('photos-people.merge-confirm-message'),
			actions: [
				{label: t('photos-people.merge'), value: 'merge', variant: 'destructive'},
				{label: t('cancel'), value: 'cancel', variant: 'default'},
			],
		}).then(
			(result) => result.actionValue === 'merge',
			() => false,
		)
	}
}
