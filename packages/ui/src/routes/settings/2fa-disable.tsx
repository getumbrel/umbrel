import {PinInput} from '@/components/ui/pin-input'
import {use2fa} from '@/hooks/use-2fa'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Dialog, DialogContent, DialogHeader, DialogPortal, DialogTitle} from '@/shadcn-components/ui/dialog'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle} from '@/shadcn-components/ui/drawer'
import {Separator} from '@/shadcn-components/ui/separator'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export default function TwoFactorDisableDialog() {
	const title = t('2fa.disable.title')
	useUmbrelTitle(title)

	const dialogProps = useDialogOpenProps('2fa-disable')

	const isMobile = useIsMobile()

	if (isMobile) {
		return (
			<Drawer {...dialogProps}>
				<DrawerContent fullHeight>
					<DrawerHeader>
						<DrawerTitle>{title}</DrawerTitle>
						<DrawerDescription>{t('2fa.disable.description')}</DrawerDescription>
					</DrawerHeader>
					<Inner />
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogContent className='flex flex-col items-center gap-5'>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
					</DialogHeader>
					<Inner />
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}

function Inner() {
	const dialogProps = useDialogOpenProps('2fa-disable')
	const {disable} = use2fa(() => dialogProps.onOpenChange(false))

	return (
		<>
			<Separator />
			<p className='text-center text-17 font-normal leading-tight -tracking-2'>{t('2fa.enter-code')}</p>
			<PinInput autoFocus length={6} onCodeCheck={disable} />
		</>
	)
}
