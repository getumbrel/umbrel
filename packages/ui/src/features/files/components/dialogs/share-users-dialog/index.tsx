import {useTranslation} from 'react-i18next'
import {useSearchParams} from 'react-router-dom'

import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useMemberShares} from '@/features/files/hooks/use-member-shares'
import {MemberSharePicker} from '@/modules/user-sharing'
import {useDialogOpenProps} from '@/utils/dialog'

// Owner dialog to share a directory with member accounts, either with all
// members (including future ones) or an explicit selection. Changes apply
// immediately.
export default function ShareUsersDialog() {
	const {t} = useTranslation()
	const [searchParams] = useSearchParams()
	const path = searchParams.get('files-share-users-path') || ''
	const name = searchParams.get('files-share-users-name') || ''
	const dialogProps = useDialogOpenProps('files-share-users')

	const {memberShares, shareForPath, addMemberShare, isAddingMemberShare, removeMemberShare, isRemovingMemberShare} =
		useMemberShares()
	const existingShare = shareForPath(path)
	// Members who already reach this folder through a share on an ancestor
	// lock on, pointing at the grant that actually controls their access. A
	// share only covers its own subtree, so "Share all folders" (the /Home
	// share) locks Home paths but not app or drive folders.
	const ancestorShares = (memberShares ?? []).filter((share) => path.startsWith(share.path + '/'))
	const lockedReason = ({userId, name}: {userId: string; name: string}) => {
		const via = ancestorShares.find((share) => share.sharedWith === 'all' || share.sharedWith.includes(userId))
		if (!via) return undefined
		if (via.path === '/Home') return t('files-share-users.locked-by-share-all', {name})
		return t('files-share-users.locked-by-ancestor', {name, folder: via.path.split('/').pop()})
	}
	// Writes replace the whole share record computed from existingShare, so
	// they must wait for the share list to load — before that, a toggle would
	// rewrite the record from nothing and drop existing members.
	const isBusy = isAddingMemberShare || isRemovingMemberShare || memberShares === undefined

	const writeShare = async (sharedWith: 'all' | string[]) => {
		try {
			if (sharedWith !== 'all' && sharedWith.length === 0) {
				if (existingShare) await removeMemberShare({path})
			} else {
				await addMemberShare({path, sharedWith})
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
						<FileItemIcon
							item={{name, path, type: 'directory', modified: 0, size: 0, operations: []}}
							className='size-11 shrink-0'
						/>
						<div className='min-w-0 flex-1'>
							<DialogTitle className='truncate'>{t('files-share-users.title', {name})}</DialogTitle>
							<DialogDescription>
								{path === '/Home' ? t('files-share-users.home-note') : t('files-share-users.description')}
							</DialogDescription>
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
