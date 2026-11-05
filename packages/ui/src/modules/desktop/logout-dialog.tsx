import {useTranslation} from 'react-i18next'
import {RiLogoutCircleRLine} from 'react-icons/ri'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {AccountAvatar} from '@/modules/auth/account-avatar'
import {useAuth} from '@/modules/auth/use-auth'
import {trpcReact} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'

export default function LogoutDialog() {
	const {t} = useTranslation()
	const dialogProps = useDialogOpenProps('logout')
	const {logout} = useAuth()
	const userQ = trpcReact.user.get.useQuery()

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader icon={userQ.data ? undefined : RiLogoutCircleRLine}>
					{userQ.data && (
						<AccountAvatar
							name={userQ.data.name}
							userId={userQ.data.userId}
							avatarUrl={userQ.data.avatarUrl}
							size={80}
							className='mx-auto'
						/>
					)}
					<AlertDialogTitle>{t('logout.confirm.title')}</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction variant='destructive' onClick={logout}>
						{t('logout.confirm.submit')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
