import {AnimatePresence, motion} from 'motion/react'
import {ReactNode, useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbAlertTriangle, TbChevronDown} from 'react-icons/tb'
import {Drawer as DrawerPrimitive} from 'vaul'

import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle} from '@/components/ui/drawer'
import {Input, Labeled, PasswordInput} from '@/components/ui/input'
import {Loading} from '@/components/ui/loading'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {Switch} from '@/components/ui/switch'
import {useIsSmallMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {trpcReact} from '@/trpc/trpc'

export function WifiHotspotDrawerOrDialog(props: React.ComponentProps<typeof DrawerPrimitive.Root>) {
	const isMobile = useIsSmallMobile()
	const Wrapper = isMobile ? Drawer : Dialog
	return <Wrapper {...props} />
}

export function WifiHotspotDrawerOrDialogContent() {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()

	const supportedQ = trpcReact.wifiHotspot.supported.useQuery()
	const statusQ = trpcReact.wifiHotspot.status.useQuery()

	const invalidate = () => {
		utils.wifiHotspot.status.invalidate()
		utils.system.getIpAddresses.invalidate()
	}

	const enableMut = trpcReact.wifiHotspot.enable.useMutation({onSettled: invalidate})
	const disableMut = trpcReact.wifiHotspot.disable.useMutation({onSettled: invalidate})

	// Local form state, seeded from the saved config
	const [ssid, setSsid] = useState('')
	const [password, setPassword] = useState('')
	const [band, setBand] = useState<'2.4ghz' | '5ghz'>('2.4ghz')
	const [channel, setChannel] = useState('0')
	const [countryCode, setCountryCode] = useState('')
	const [hidden, setHidden] = useState(false)
	const [bridgeToLan, setBridgeToLan] = useState(false)
	const [showAdvanced, setShowAdvanced] = useState(false)

	const status = statusQ.data
	useEffect(() => {
		if (!status) return
		setSsid(status.ssid)
		setPassword(status.password)
		setBand(status.band)
		setChannel(String(status.channel ?? 0))
		setCountryCode(status.countryCode ?? '')
		setHidden(status.hidden)
		setBridgeToLan(status.bridgeToLan)
	}, [status])

	const enabled = status?.enabled ?? false
	const isBusy = enableMut.isPending || disableMut.isPending

	const save = () => {
		enableMut.mutate({
			ssid,
			password,
			band,
			channel: Number(channel) || 0,
			countryCode: countryCode ? countryCode.toUpperCase() : undefined,
			hidden,
			bridgeToLan,
		})
	}

	const toggleEnabled = (next: boolean) => {
		if (next) save()
		else disableMut.mutate()
	}

	const errorMessage = enableMut.error?.message
	const passwordValid = password.length >= 8 && password.length <= 63
	const canSave = ssid.trim().length > 0 && passwordValid && !isBusy

	return (
		<DrawerOrDialogContent
			header={
				supportedQ.data ? (
					<Switch
						checked={enabled}
						onCheckedChange={toggleEnabled}
						disabled={isBusy || statusQ.isLoading || (!enabled && !canSave)}
					/>
				) : undefined
			}
		>
			{supportedQ.isLoading || statusQ.isLoading ? (
				<Message>
					<Loading />
				</Message>
			) : !supportedQ.data ? (
				<Message>{t('wifi-hotspot-unsupported')}</Message>
			) : (
				<form
					className='flex flex-col gap-4'
					onSubmit={(e) => {
						e.preventDefault()
						if (canSave) save()
					}}
				>
					<Labeled label={t('wifi-hotspot-ssid')}>
						<Input placeholder={t('wifi-hotspot-ssid-placeholder')} value={ssid} onValueChange={setSsid} />
					</Labeled>

					<PasswordInput
						label={t('password')}
						value={password}
						onValueChange={setPassword}
						error={password.length > 0 && !passwordValid ? t('wifi-hotspot-password-invalid') : undefined}
					/>

					{/* Advanced settings */}
					<button
						type='button'
						className='flex items-center gap-1 text-13 font-medium text-white/60 transition-colors hover:text-white/90'
						onClick={() => setShowAdvanced((v) => !v)}
					>
						{t('wifi-hotspot-advanced')}
						<TbChevronDown className={cn('size-4 transition-transform', showAdvanced && 'rotate-180')} />
					</button>

					<AnimatePresence initial={false}>
						{showAdvanced && (
							<motion.div
								className='overflow-hidden'
								initial={{height: 0, opacity: 0}}
								animate={{height: 'auto', opacity: 1}}
								exit={{height: 0, opacity: 0}}
								transition={{duration: 0.2, ease: 'easeInOut'}}
							>
								<div className='flex flex-col gap-4 pt-1'>
									<Labeled label={t('wifi-hotspot-band')}>
										<SegmentedControl
											size='lg'
											value={band}
											onValueChange={setBand}
											tabs={[
												{id: '2.4ghz', label: t('wifi-hotspot-band-2ghz')},
												{id: '5ghz', label: t('wifi-hotspot-band-5ghz')},
											]}
										/>
									</Labeled>

									<div className='grid grid-cols-2 gap-3'>
										<Labeled label={t('wifi-hotspot-channel')}>
											<Input
												type='number'
												min={0}
												placeholder={t('wifi-hotspot-channel-auto')}
												value={channel}
												onValueChange={setChannel}
											/>
										</Labeled>
										<Labeled label={t('wifi-hotspot-country')}>
											<Input
												placeholder='US'
												maxLength={2}
												value={countryCode}
												onValueChange={(v) => setCountryCode(v.toUpperCase())}
											/>
										</Labeled>
									</div>

									<Row title={t('wifi-hotspot-hidden')} description={t('wifi-hotspot-hidden-description')}>
										<Switch checked={hidden} onCheckedChange={setHidden} />
									</Row>

									<Row title={t('wifi-hotspot-bridge')} description={t('wifi-hotspot-bridge-description')}>
										<Switch checked={bridgeToLan} onCheckedChange={setBridgeToLan} />
									</Row>

									{bridgeToLan && (
										<div className='flex items-start gap-1.5 text-12 text-yellow-300'>
											<TbAlertTriangle className='mt-0.5 size-4 shrink-0' />
											<span>{t('wifi-hotspot-bridge-warning')}</span>
										</div>
									)}
								</div>
							</motion.div>
						)}
					</AnimatePresence>

					{errorMessage && <div className='text-13 text-destructive2-lightest'>{errorMessage}</div>}

					<Button type='submit' variant='primary' size='dialog' disabled={!canSave}>
						{enabled ? t('wifi-hotspot-update') : t('wifi-hotspot-enable')}
					</Button>
				</form>
			)}
		</DrawerOrDialogContent>
	)
}

function Row({title, description, children}: {title: string; description?: string; children: ReactNode}) {
	return (
		<div className='flex items-center justify-between gap-4'>
			<div className='space-y-0.5'>
				<div className='text-14 font-medium leading-tight'>{title}</div>
				{description && <div className='text-12 leading-tight text-white/40'>{description}</div>}
			</div>
			{children}
		</div>
	)
}

function DrawerOrDialogContent({header, children}: {header?: ReactNode; children: ReactNode}) {
	const {t} = useTranslation()
	const isMobile = useIsSmallMobile()

	const Content = isMobile ? DrawerContent : DialogContent
	const Header = isMobile ? DrawerHeader : DialogHeader
	const Title = isMobile ? DrawerTitle : DialogTitle
	const Description = isMobile ? DrawerDescription : DialogDescription

	return (
		<Content className='mx-auto px-[20px] py-[30px] sm:max-w-[560px]'>
			<Header className='flex flex-row items-center justify-between gap-4'>
				<div className='space-y-0.5'>
					<Title>{t('wifi-hotspot')}</Title>
					<Description className='text-12 leading-tight'>{t('wifi-hotspot-description-long')}</Description>
				</div>
				{header}
			</Header>
			{children}
		</Content>
	)
}

function Message({children}: {children?: React.ReactNode}) {
	return (
		<div className='grid h-32 place-items-center rounded-12 bg-white/6 p-4'>
			<div className='text-center text-14 font-medium -tracking-2 opacity-60'>{children}</div>
		</div>
	)
}
