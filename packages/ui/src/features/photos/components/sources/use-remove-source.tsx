import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {sectionPath} from '@/features/photos/constants'
import {sourceKind, usePhotoSourceActions, type PhotoSource} from '@/features/photos/hooks/use-photo-sources'
import type {ConfirmationOptions} from '@/providers/confirmation/types'
import {useConfirmation} from '@/providers/confirmation/use-confirmation'
import {trpcReact} from '@/trpc/trpc'
import {formatNumberI18n} from '@/utils/number'

// Two-step, explicit removal shared by the sidebar menu, the overview tiles and
// the details dialog: stop importing and keep the items (default), or take the
// items out of Photos too. Originals on the device are never touched. For a
// phone, the dialog says how many items would really go to Trash: photos also
// elsewhere on the Umbrel, such as ones another phone backed up, always stay.
export function useRemoveSource() {
	const {t, i18n} = useTranslation()
	const confirm = useConfirmation()
	const navigate = useNavigate()
	const utils = trpcReact.useUtils()
	const {removeSource, isRemoving} = usePhotoSourceActions()
	const format = (n: number) => formatNumberI18n({n, showDecimals: false, locale: i18n.language})
	const cancel = {label: t('cancel'), value: 'cancel', variant: 'default'} as const

	const folderRemoval = (source: PhotoSource): ConfirmationOptions => {
		const count = source.stats.photos + source.stats.videos
		return {
			title: t('photos-source.remove-title', {name: source.name}),
			message: t('photos-source.remove-message', {count, formattedCount: format(count)}),
			actions: [
				{label: t('photos-source.remove-keep-items'), value: 'keep', variant: 'primary'},
				{label: t('photos-source.remove-with-items'), value: 'remove-items', variant: 'destructive'},
				cancel,
			],
		}
	}

	const phoneRemoval = async (source: PhotoSource): Promise<ConfirmationOptions> => {
		const total = source.stats.photos + source.stats.videos
		const trashed = Math.min(await utils.photos.sources.removalItemCount.fetch({id: source.id}), total)
		const kept = total - trashed
		const title = t('photos-source.remove-title', {name: source.name})
		const message = (first: string) => (
			<>
				<span className='block'>{first}</span>
				<span className='mt-2 block'>{t('photos-source.remove-phone-stops')}</span>
			</>
		)
		if (trashed === 0) {
			return {
				title,
				message: message(t('photos-source.remove-phone-all-elsewhere')),
				actions: [{label: t('photos-source.remove-phone-remove'), value: 'keep', variant: 'destructive'}, cancel],
			}
		}
		if (kept === 0) {
			return {
				title,
				message: message(t('photos-source.remove-phone-none-elsewhere', {count: total, formattedCount: format(total)})),
				actions: [
					{label: t('photos-source.remove-phone-keep'), value: 'keep', variant: 'primary'},
					{label: t('photos-source.remove-phone-trash'), value: 'remove-items', variant: 'destructive'},
					cancel,
				],
			}
		}
		const only = format(trashed)
		return {
			title,
			message: message(
				`${t('photos-source.remove-phone-only-here', {count: trashed, formattedCount: only})} ${t(
					'photos-source.remove-phone-elsewhere',
					{count: kept, formattedCount: format(kept)},
				)}`,
			),
			actions: [
				{label: t('photos-source.remove-phone-keep-count', {formattedCount: only}), value: 'keep', variant: 'primary'},
				{
					label: t('photos-source.remove-phone-trash-count', {formattedCount: only}),
					value: 'remove-items',
					variant: 'destructive',
				},
				cancel,
			],
		}
	}

	const remove = async (source: PhotoSource, {navigateAway = false} = {}) => {
		// Without the count, as for a backup whose earlier removal didn't finish, it asks
		// as for a folder. Removal still only trashes what's nowhere else on the Umbrel.
		const options =
			sourceKind(source.type) === 'push'
				? await phoneRemoval(source).catch(() => folderRemoval(source))
				: folderRemoval(source)
		try {
			const {actionValue} = await confirm(options)
			if (actionValue === 'cancel') return false
			await removeSource({id: source.id, keepItems: actionValue === 'keep'})
			if (navigateAway) navigate(sectionPath('sources'))
			return true
		} catch {
			return false
		}
	}

	return {remove, isRemoving}
}
