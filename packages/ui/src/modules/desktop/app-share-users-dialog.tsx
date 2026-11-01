import {useTranslation} from 'react-i18next'
import {useSearchParams} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {useAppMemberShares} from '@/hooks/use-app-member-shares'
import {MemberSharePicker} from '@/modules/user-sharing'
import {trpcReact} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'

// Owner dialog to share an app with member accounts, either with all members
// (including future ones) or an explicit selection. Shared apps show on the
// member's desktop and are allowed through the app proxy. Changes apply
// immediately.
export function AppShareUsersDialog() {
	const {t} = useTranslation()
	const [searchParams] = useSearchParams()
	const appId = searchParams.get('app-share-users-for') || ''
	const dialogProps = useDialogOpenProps('app-share-users')

	const appsQ = trpcReact.apps.list.useQuery(undefined, {enabled: dialogProps.open})
	const appEntry = appsQ.data?.find((app) => app.id === appId)
	const appName = appId === '*' ? t('users.all-apps') : appEntry && 'name' in appEntry ? appEntry.name : appId
	const appIcon = appEntry && 'icon' in appEntry ? appEntry.icon : undefined

	const {
		appMemberShares,
		shareForApp,
		addAppMemberShare,
		isAddingAppMemberShare,
		removeAppMemberShare,
		isRemovingAppMemberShare,
	} = useAppMemberShares()
	const existingShare = shareForApp(appId)
	// Members covered by the '*' share already have this app via "Share all
	// apps"; their rows lock on and point to where that's controlled
	const allAppsShare = appId === '*' ? undefined : shareForApp('*')
	const lockedReason = ({userId, name}: {userId: string; name: string}) =>
		allAppsShare && (allAppsShare.sharedWith === 'all' || allAppsShare.sharedWith.includes(userId))
			? t('app-share-users.locked-by-share-all', {name})
			: undefined
	// Writes replace the whole share record computed from existingShare, so
	// they must wait for the share list to load — before that, a toggle would
	// rewrite the record from nothing and drop other members' access
	const isBusy = isAddingAppMemberShare || isRemovingAppMemberShare || appMemberShares === undefined

	const writeShare = async (sharedWith: 'all' | string[]) => {
		try {
			if (sharedWith !== 'all' && sharedWith.length === 0) {
				if (existingShare) await removeAppMemberShare({appId})
			} else {
				await addAppMemberShare({appId, sharedWith})
			}
		} catch {
			// Error toast comes from the mutation
		}
	}

	return (
		<Dialog {...dialogProps}>
			<DialogContent className='flex flex-col gap-5'>
				<DialogHeader>
					<div className='flex items-center gap-3'>
						<AppIcon size={44} src={appIcon} className='shrink-0 rounded-10' />
						<div className='min-w-0 flex-1'>
							<DialogTitle className='truncate'>{t('app-share-users.title', {name: appName})}</DialogTitle>
							<DialogDescription>{t('app-share-users.description')}</DialogDescription>
						</div>
					</div>
				</DialogHeader>

				<MemberSharePicker
					sharedWith={existingShare?.sharedWith}
					isBusy={isBusy}
					onChange={writeShare}
					lockedReason={lockedReason}
				/>
			</DialogContent>
		</Dialog>
	)
}
