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
import {useAuth} from '@/modules/auth/use-auth'
import {useDialogOpenProps} from '@/utils/dialog'

export function LogoutDialog() {
	const {t} = useTranslation()
	// TODO: Enable hook below after this component is only injected as needed rather than all the time
	// useUmbrelTitle('Log out')
	const dialogProps = useDialogOpenProps('logout')
	const {logout} = useAuth()

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader icon={RiLogoutCircleRLine}>
					<AlertDialogTitle>{t('logout.confirm.title')}</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction variant='destructive' className='px-6' onClick={logout}>
						{t('logout.confirm.submit')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
