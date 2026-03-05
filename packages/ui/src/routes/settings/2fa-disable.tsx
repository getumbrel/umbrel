import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Drawer, DrawerContent, DrawerHeader, DrawerTitle} from '@/components/ui/drawer'
import {PinInput} from '@/components/ui/pin-input'
import {Separator} from '@/components/ui/separator'
import {use2fa} from '@/hooks/use-2fa'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {t} from '@/utils/i18n'

export default function TwoFactorDisableDialog() {
	const title = t('2fa.disable.title')

	const isMobile = useIsMobile()
	const dialogProps = useSettingsDialogProps()

	const {disable} = use2fa(() => dialogProps.onOpenChange(false))

	if (isMobile) {
		return (
			<Drawer {...dialogProps}>
				<DrawerContent fullHeight>
					<DrawerHeader>
						<DrawerTitle>{title}</DrawerTitle>
					</DrawerHeader>
					<Inner onCodeCheck={disable} />
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog {...dialogProps}>
			<DialogContent className='flex flex-col items-center gap-5'>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				<Inner onCodeCheck={disable} />
			</DialogContent>
		</Dialog>
	)
}

function Inner({onCodeCheck}: {onCodeCheck: (code: string) => Promise<boolean>}) {
	return (
		<>
			<Separator />
			<p className='text-17 leading-tight font-normal -tracking-2'>{t('2fa.enter-code')}</p>
			<PinInput autoFocus length={6} onCodeCheck={onCodeCheck} />
		</>
	)
}
