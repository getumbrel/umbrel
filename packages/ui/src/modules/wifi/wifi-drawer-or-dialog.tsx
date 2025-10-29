import {AnimatePresence, motion} from 'framer-motion'
import {ReactNode, useEffect, useRef, useState} from 'react'
import {TbAlertTriangle} from 'react-icons/tb'
import {Drawer as DrawerPrimitive} from 'vaul'

import {Loading} from '@/components/ui/loading'
import {useAutoHeightAnimation} from '@/hooks/use-auto-height-animation'
import {useIsSmallMobile} from '@/hooks/use-is-mobile'
import {WifiListItemContent} from '@/modules/wifi/wifi-item-content'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import {Button} from '@/shadcn-components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/shadcn-components/ui/dialog'
import {Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle} from '@/shadcn-components/ui/drawer'
import {PasswordInput} from '@/shadcn-components/ui/input'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {Switch} from '@/shadcn-components/ui/switch'
import {cn} from '@/shadcn-lib/utils'
import {RouterOutput, trpcReact, WifiNetwork, WifiStatus, WifiStatusUi} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

type NetworkStatus = RouterOutput['wifi']['connected']

export function WifiDrawerOrDialogContent() {
	const utils = trpcReact.useUtils()
	const statusQ = trpcReact.wifi.connected.useQuery()
	const networkStatus = statusQ.data

	const disconnectMut = trpcReact.wifi.disconnect.useMutation({
		onSettled: () => {
			utils.wifi.connected.invalidate()
			utils.system.getIpAddresses.invalidate()
		},
	})

	const networksQ = trpcReact.wifi.networks.useQuery(undefined, {
		// If we come back to the tab after 2 seconds away, we want to refresh the networks
		staleTime: 2000,
	})
	const namedNetworks = networksQ.data?.filter((network) => !!network.ssid)

	const [controls, ref] = useAutoHeightAnimation([networksQ.isFetching])

	const [disableAlertOpen, setDisableAlertOpen] = useState(false)

	return (
		<DrawerOrDialogContent
			header={
				statusQ.data?.status === 'connected' && (
					<>
						<Switch
							className='mt-0 disabled:pointer-events-none'
							checked={statusQ.data?.status === 'connected'}
							onCheckedChange={(toCheck) => !toCheck && setDisableAlertOpen(true)}
							disabled={disconnectMut.isPending || statusQ.isFetching || statusQ.data?.status !== 'connected'}
						/>
						<AlertDialog open={disableAlertOpen} onOpenChange={setDisableAlertOpen}>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>{t('wifi-dangerous-disable-confirmation-title')}</AlertDialogTitle>
									<AlertDialogDescription>
										{t('wifi-dangerous-disable-confirmation-description')}
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogAction
										variant='destructive'
										onClick={() => {
											// Invalidate queries so other parts of the interface can update
											utils.wifi.connected.invalidate()
											disconnectMut.mutate()
											setDisableAlertOpen(false)
										}}
									>
										{t('disable')}
									</AlertDialogAction>
									<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</>
				)
			}
		>
			<motion.div
				className='overflow-hidden'
				animate={controls}
				transition={{
					duration: 0.3,
					ease: 'easeInOut',
				}}
			>
				<div ref={ref}>
					{networksQ.isLoading ? (
						<Message>
							<Loading>{t('wifi-searching')}</Loading>
						</Message>
					) : (
						<EnabledContent
							namedNetworks={namedNetworks}
							networkStatus={networkStatus}
							isLoading={networksQ.isFetching}
							errorMessage={networksQ.error?.message}
						/>
					)}
				</div>
			</motion.div>
		</DrawerOrDialogContent>
	)
}

export function WifiDrawerOrDialog(props: React.ComponentProps<typeof DrawerPrimitive.Root>) {
	const isMobile = useIsSmallMobile()
	const Wrapper = isMobile ? Drawer : Dialog

	return <Wrapper {...props} />
}

export function DrawerOrDialogContent({header, children}: {header?: ReactNode; children: ReactNode}) {
	const title = t('wifi')

	const isMobile = useIsSmallMobile()

	const Content = isMobile ? DrawerContent : DialogContent
	const Header = isMobile ? DrawerHeader : DialogHeader
	const Title = isMobile ? DrawerTitle : DialogTitle
	const Description = isMobile ? DrawerDescription : DialogDescription

	return (
		<Content className='mx-auto px-[20px] py-[30px] sm:max-w-[560px]'>
			<Header className='flex flex-row items-center justify-between gap-4'>
				<div className='space-y-0.5'>
					<Title>{title}</Title>
					<Description className='text-12 leading-tight'>{t('wifi-description-long')}</Description>
				</div>
				{header}
			</Header>
			{children}
		</Content>
	)
}

export function EnabledContent({
	isLoading,
	errorMessage,
	namedNetworks,
	networkStatus,
}: {
	isLoading?: boolean
	errorMessage?: string
	namedNetworks?: WifiNetwork[]
	networkStatus?: NetworkStatus
}) {
	const [openSsid, setOpenSsid] = useState<string | undefined>(undefined)
	const currentSsid = networkStatus?.status === 'disconnected' ? undefined : networkStatus?.ssid

	// Scroll to top when connected network changes
	// But we don't wanna scroll to the top when a network is added or removed
	const scrollRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = 0
		}
	}, [currentSsid])

	if (errorMessage) {
		return <Message>{errorMessage}</Message>
	}

	const currentStatus = networkStatus?.status
	const connectedNetwork =
		currentStatus === 'connected' ? namedNetworks?.find((network) => network.ssid === currentSsid) : undefined

	// named networks except the one we're currently connected to
	const availableNetworks = namedNetworks?.filter((network) => network.ssid !== connectedNetwork?.ssid)

	if (!namedNetworks || namedNetworks.length === 0) {
		return <Message>{t('wifi-no-networks-message')}</Message>
	}

	return (
		<ScrollArea
			scrollbarClass='my-3'
			className={cn('flex h-[380px] flex-col rounded-12 bg-white/5 transition-opacity', isLoading && 'opacity-50')}
			viewportRef={scrollRef}
		>
			{connectedNetwork && (
				<div className={cn(wifiListItemClass, 'pointer-events-none')}>
					<WifiListItemContent status='connected' network={connectedNetwork} />
				</div>
			)}
			{availableNetworks?.map((network) => (
				<Network
					key={network.ssid}
					network={network}
					isWifiActive={currentStatus === 'connected'}
					isOpen={openSsid === network.ssid}
					setIsOpen={(o) => (o ? setOpenSsid(network.ssid) : setOpenSsid(undefined))}
					status={network.ssid === currentSsid ? currentStatus : undefined}
				/>
			))}
		</ScrollArea>
	)
}

function Network({
	network,
	status,
	isOpen,
	setIsOpen,
	isWifiActive,
}: {
	network: WifiNetwork
	status?: WifiStatus
	isOpen: boolean
	isWifiActive: boolean
	setIsOpen: (open: boolean) => void
}) {
	const passwordInputRef = useRef<HTMLInputElement>(null)

	const utils = trpcReact.useUtils()
	const connectMut = trpcReact.wifi.connect.useMutation({
		onMutate: () => {
			utils.wifi.connected.cancel()
		},
		onSuccess: () => setIsOpen(false),
		onError: () => {
			setTimeout(() => {
				passwordInputRef.current?.select()
				passwordInputRef.current?.focus()
			}, 200)
		},
		onSettled: () => {
			utils.wifi.connected.invalidate()
			utils.system.getIpAddresses.invalidate()
		},
	})

	useEffect(() => {
		// Reset error
		if (!isOpen) {
			connectMut.reset()
		}
	}, [isOpen, connectMut])

	const connect = ({ssid, password}: {ssid: string; password?: string}) => {
		connectMut.mutate({ssid, password})
	}

	const statusUi = connectMut.isPending ? 'loading' : status

	// Show password error under the password input and other errors in a differnt place
	const errorMessage = connectMut.error?.message
	const isPasswordError = errorMessage === 'Incorrect password'
	const passwordError = isPasswordError ? errorMessage : undefined
	const otherError = isPasswordError ? undefined : errorMessage

	const ConnectComponent = isWifiActive ? ConnectWithConfirmation : Connect

	return (
		<motion.div
			// use position layout to avoid stretching
			layout='position'
			key={network.ssid}
			className={cn(wifiListItemClass, '!gap-0')}
			onClick={() => setIsOpen(true)}
			role={isOpen ? undefined : 'button'}
			tabIndex={0}
		>
			<WifiListItemContent network={network} status={statusUi} error={otherError} />
			<AnimatePresence>
				{isOpen && !connectMut.isPending && (
					<AnimateHeight>
						<ConnectComponent
							passwordInputRef={passwordInputRef}
							network={network}
							status={statusUi}
							onConnect={connect}
							error={passwordError}
						/>
					</AnimateHeight>
				)}
			</AnimatePresence>
		</motion.div>
	)
}

function AnimateHeight({children}: {children: ReactNode}) {
	return (
		<motion.div
			layout='position'
			initial={{opacity: 0, height: 0}}
			animate={{
				height: 'auto',
				opacity: 1,
				marginTop: 8,
				transition: {
					height: {
						duration: 0.15,
					},
					opacity: {
						duration: 0.15,
						delay: 0.15,
					},
				},
			}}
			exit={{
				height: 0,
				opacity: 0,
				marginTop: 0,
				transition: {
					height: {
						duration: 0.15,
					},
					opacity: {
						duration: 0.15,
					},
				},
			}}
		>
			{children}
		</motion.div>
	)
}

type ConnectData = {ssid: string; password?: string}
type ConnectProps = {
	network: WifiNetwork
	status?: WifiStatusUi
	onConnect: ({ssid, password}: ConnectData) => void
	error?: string
	passwordInputRef?: React.RefObject<HTMLInputElement>
}

function ConnectWithConfirmation({onConnect, ...rest}: ConnectProps) {
	const [data, setData] = useState<ConnectData | undefined>(undefined)
	const [open, setOpen] = useState(false)

	return (
		<>
			<Connect
				onConnect={(data) => {
					setData(data)
					setOpen(true)
				}}
				{...rest}
			/>
			<AlertDialog open={open} onOpenChange={setOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('wifi-dangerous-change-confirmation-title')}</AlertDialogTitle>
						<AlertDialogDescription>{t('wifi-dangerous-change-confirmation-description')}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction
							variant='destructive'
							onClick={() => {
								if (!data) return
								onConnect(data)
								setOpen(false)
							}}
						>
							{t('change')}
						</AlertDialogAction>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}

export function Connect({network, status, onConnect, error, passwordInputRef}: ConnectProps) {
	const [password, setPassword] = useState('')

	if (status === 'loading') {
		return null
	}

	if (network.authenticated) {
		return (
			<form
				onSubmit={(e) => {
					e.preventDefault()
					onConnect({ssid: network.ssid, password})
				}}
				className='flex gap-2'
			>
				<PasswordInput
					inputRef={passwordInputRef}
					autoFocus
					label={t('password')}
					sizeVariant={'short'}
					className='flex-1'
					value={password}
					onValueChange={setPassword}
					error={error}
				/>
				<Button type='submit' variant='primary' size='input-short'>
					{t('connect')}
				</Button>
			</form>
		)
	} else {
		return (
			<form
				onSubmit={(e) => {
					e.preventDefault()
					onConnect({ssid: network.ssid})
				}}
				className='flex items-center gap-2'
			>
				<div className='flex flex-1 items-center gap-1 text-sm text-yellow-300'>
					<TbAlertTriangle className='size-4' />
					<span>{t('wifi-connect-insecure-message')}</span>
				</div>
				<Button type='submit' variant='primary' size='input-short' autoFocus>
					Connect
				</Button>
			</form>
		)
	}
}

export function Message({children}: {children?: React.ReactNode}) {
	return (
		<div className='grid h-32 place-items-center rounded-12 bg-white/6 p-4'>
			<div className='text-center text-14 font-medium -tracking-2 opacity-60'>{children}</div>
		</div>
	)
}

export const wifiListItemClass = tw`w-full p-3 hover:bg-white/6 focus-within:bg-white/6 transition-colors border-b border-t first:border-t-0 last:border-b-0 mb-[-1px] border-white/6 outline-none flex flex-col gap-3`
