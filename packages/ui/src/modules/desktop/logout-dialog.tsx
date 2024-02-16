import {RiLogoutCircleRLine} from 'react-icons/ri'

import {useAuth} from '@/modules/auth/use-auth'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export function LogoutDialog() {
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
