import {motion} from 'framer-motion'
import {ReactNode, useEffect} from 'react'
import QRCode from 'react-qr-code'

import {CopyableField} from '@/components/ui/copyable-field'
import {Loading} from '@/components/ui/loading'
import {PinInput} from '@/components/ui/pin-input'
import {use2fa} from '@/hooks/use-2fa'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogScrollableContent,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {Separator} from '@/shadcn-components/ui/separator'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

export default function TwoFactorEnableDialog() {
	const title = t('2fa.enable.title')
	const scanThisMessage = t('2fa.enable.scan-this')

	const isMobile = useIsMobile()
	const dialogProps = useSettingsDialogProps()

	// const dialogProps = useDialogOpenProps('2fa-enable')
	const {enable, totpUri, generateTotpUri} = use2fa(() => dialogProps.onOpenChange(false))
	useEffect(generateTotpUri, [generateTotpUri])

	if (isMobile) {
		return (
			<Drawer {...dialogProps}>
				<DrawerContent fullHeight>
					<DrawerHeader>
						<DrawerTitle>{title}</DrawerTitle>
						<DrawerDescription>{t('2fa-description')}</DrawerDescription>
					</DrawerHeader>
					<DrawerScroller>
						<p className={paragraphClass}>{scanThisMessage}</p>
						<div className='flex flex-col items-center gap-5'>
							{/* NOTE: keep this small so that the pin input is visible within the viewport */}
							<Inner qrCodeSize={150} totpUri={totpUri} onCodeCheck={enable} />
							<div className='mb-4' />
						</div>
					</DrawerScroller>
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog {...dialogProps}>
			<DialogScrollableContent>
				<div className='flex flex-col items-center gap-5 p-8'>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>{scanThisMessage}</DialogDescription>
					</DialogHeader>
					<Inner totpUri={totpUri} onCodeCheck={enable} />
				</div>
			</DialogScrollableContent>
		</Dialog>
	)
}

const paragraphClass = tw`text-left text-13 font-normal leading-tight -tracking-2 text-white/60`

function Inner({
	qrCodeSize = 240,
	totpUri,
	onCodeCheck,
}: {
	qrCodeSize?: number
	totpUri: string
	onCodeCheck: (code: string) => Promise<boolean>
}) {
	return (
		<>
			<AnimateInQr size={qrCodeSize} animateIn={!!totpUri}>
				<QRCode
					size={256}
					style={{height: 'auto', maxWidth: '100%', width: '100%', opacity: totpUri ? 1 : 0}}
					value={totpUri}
					viewBox={`0 0 256 256`}
				/>
			</AnimateInQr>
			<div className='w-full space-y-2 text-center'>
				<p className='text-13 font-normal leading-tight -tracking-2 text-white/60'>{t('2fa.enable.or-paste')}</p>
				<CopyableField value={totpUri} />
			</div>
			<Separator />
			<p className='text-center text-sm font-normal leading-tight -tracking-2'>{t('2fa.enter-code')}</p>
			<PinInput length={6} onCodeCheck={onCodeCheck} />
		</>
	)
}

const AnimateInQr = ({children, size, animateIn}: {children: ReactNode; size: number; animateIn?: boolean}) => (
	<div
		className='relative mx-auto'
		style={{
			perspective: '300px',
			width: size + 'px',
		}}
	>
		<motion.div
			className='rounded-8 bg-white p-3'
			initial={{
				opacity: 0,
				rotateX: 20,
				rotateY: 10,
				rotateZ: 0,
				scale: 0.5,
			}}
			animate={
				animateIn && {
					opacity: 1,
					rotateX: 0,
					rotateY: 0,
					rotateZ: 0,
					scale: 1,
				}
			}
			transition={{duration: 0.15, ease: 'easeOut'}}
		>
			{children}
		</motion.div>
		{!animateIn && (
			<div className='absolute inset-0 grid place-items-center'>
				<Loading />
			</div>
		)}
	</div>
)
