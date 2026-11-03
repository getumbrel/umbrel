import {useTranslation} from 'react-i18next'

import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle} from '@/components/ui/drawer'
import {PinInput} from '@/components/ui/pin-input'
import {use2fa} from '@/hooks/use-2fa'
import {useIsPhone} from '@/hooks/use-is-mobile'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'

// Laid out like the enable dialog: a left-aligned title over its instruction,
// then the code boxes
export default function TwoFactorDisableDialog({closeTo}: {closeTo?: string}) {
	const {t} = useTranslation()
	const title = t('2fa.disable.title')
	const description = t('2fa.enter-code')

	const isPhone = useIsPhone()
	const dialogProps = useSettingsDialogProps({closeTo})

	const {disable} = use2fa(() => dialogProps.onOpenChange(false))

	if (isPhone) {
		return (
			<Drawer {...dialogProps}>
				<DrawerContent fullHeight>
					<DrawerHeader>
						<DrawerTitle>{title}</DrawerTitle>
						<DrawerDescription>{description}</DrawerDescription>
					</DrawerHeader>
					<div className='flex justify-center'>
						<PinInput autoFocus length={6} onCodeCheck={disable} />
					</div>
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog {...dialogProps}>
			<DialogContent className='items-center'>
				<DialogHeader className='self-stretch'>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<PinInput autoFocus length={6} onCodeCheck={disable} />
			</DialogContent>
		</Dialog>
	)
}
