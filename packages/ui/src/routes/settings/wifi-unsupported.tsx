import {TbWifi} from 'react-icons/tb'

import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import {t} from '@/utils/i18n'

export default function WifiUnsupported() {
	const dialogProps = useSettingsDialogProps()

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('wifi')}</AlertDialogTitle>
				</AlertDialogHeader>
				<div className='mt-2 flex justify-center'>
					<Icon />
				</div>
				<AlertDialogDescription className='text-center'>
					{t('wifi-unsupported-device-description')}
				</AlertDialogDescription>
				<AlertDialogFooter>
					<AlertDialogAction onClick={() => dialogProps.onOpenChange(false)}>{t('ok')}</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}

function Icon() {
	return (
		// Stolen from factory reset sidebar icon
		<div
			className='grid h-[67px] w-[67px] place-items-center rounded-15 bg-white/6'
			style={{boxShadow: '0 1px 1px #ffffff33 inset'}}
		>
			<TbWifi className='h-[40px] w-[40px]' />
		</div>
	)
}
