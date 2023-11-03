import {createContext, ReactNode, useContext, useEffect, useState} from 'react'

import {Progress} from '@/shadcn-components/ui/progress'
import {cn} from '@/shadcn-lib/utils'

import {widgetContainerCva, widgetTextCva} from './shared'
import {TablerIcon} from './tabler-icon'

export type WidgetType =
	| 'stat-with-progress'
	| 'stat-with-buttons'
	| 'three-up'
	| 'four-up'
	| 'actions'
	| 'notifications'

export type WidgetConfig = {
	type: WidgetType
	endpoint: string
}

export function widgetConfigToWidget(widgetConfig: WidgetConfig) {
	switch (widgetConfig.type) {
		case 'stat-with-progress':
			return <ConnectedProgressWidget endpoint={widgetConfig.endpoint} />
		case 'stat-with-buttons':
			return <ConnectedStatWithButtonsWidget endpoint={widgetConfig.endpoint} />
		case 'three-up':
			return <ThreeUpWidget />
		case 'four-up':
			return <FourUpWidget />
		case 'actions':
			return <ActionsWidget />
		case 'notifications':
			return <NotificationsWidget />
	}
}

type Variant = 'with-backdrop-blur' | 'default'
export const BackdropBlurVariantContext = createContext<Variant>('with-backdrop-blur')

export function WidgetWrapper({label, children}: {label: string; children?: ReactNode}) {
	return (
		<div
			className={cn('flex w-[var(--widget-w)] flex-col items-center justify-between', label && 'h-[var(--widget-h)]')}
		>
			{children}
			{label && (
				<div className='desktop relative z-0 max-w-full truncate text-center text-13 leading-normal drop-shadow-desktop-label contrast-more:bg-black contrast-more:px-1'>
					{label}
				</div>
			)}
		</div>
	)
}

export function ConnectedProgressWidget({endpoint}: {endpoint: string}) {
	const [isLoading, setIsLoading] = useState(true)
	const [props, setProps] = useState<Parameters<typeof ProgressWidget>[0]>()

	useEffect(() => {
		setIsLoading(true)
		fetch(endpoint)
			.then((res) => res.json())
			.then((data) => {
				console.log(data)
				setIsLoading(false)
				setProps(data)
			})
	}, [endpoint])

	const variant = useContext(BackdropBlurVariantContext)

	if (isLoading) {
		return <div className={widgetContainerCva({variant})}></div>
	}

	return <ProgressWidget {...props} />
}

export function ProgressWidget({
	title,
	value,
	valueSub,
	progressLabel,
	progress = 0,
}: {
	title?: string
	value?: string
	valueSub?: string
	progressLabel?: string
	progress?: number
}) {
	const variant = useContext(BackdropBlurVariantContext)
	return (
		<div className={widgetContainerCva({variant})}>
			<StatText title={title} value={value} valueSub={valueSub} />
			<div className='flex-1' />
			{/* TODO: use shadcn progress component */}
			<div className={widgetTextCva({opacity: 'secondary'})}>{progressLabel || 'In progress'}</div>
			<Progress value={progress * 100} />
		</div>
	)
}

export function StatText({title, value, valueSub}: {title?: string; value?: string; valueSub?: string}) {
	return (
		<div className='flex flex-col gap-2'>
			{title && <div className={widgetTextCva({opacity: 'secondary'})}>{title}</div>}
			<div className='truncate text-24 font-semibold leading-none -tracking-3 opacity-80'>
				{value}
				<span className='ml-1 text-13 font-bold opacity-[45%]'>{valueSub}</span>
			</div>
		</div>
	)
}

export function ThreeUpWidget() {
	const variant = useContext(BackdropBlurVariantContext)
	return (
		<div className={cn(widgetContainerCva({variant}), 'grid grid-cols-3 justify-stretch gap-2 px-4 py-3')}>
			<ThreeUpItem iconName='settings' title='Optimal' value='56°C' />
			<ThreeUpItem iconName='settings' title='Free' value='1.75 TB' />
			<ThreeUpItem iconName='settings' title='Memory' value='5.8 GB' />
		</div>
	)
}

function ThreeUpItem({iconName, title, value}: {iconName: string; title?: string; value?: string}) {
	return (
		<div className='flex flex-col items-center justify-center rounded-full bg-white/5'>
			{/* `[&>svg]` to select child svg */}
			<TablerIcon iconName={iconName} className='[&>svg]:h-5 [&>svg]:w-5' />
			<p className={widgetTextCva({opacity: 'secondary', className: 'mt-4'})}>{title}</p>
			<p className={widgetTextCva()}>{value}</p>
		</div>
	)
}

export function ConnectedStatWithButtonsWidget({endpoint}: {endpoint: string}) {
	const [isLoading, setIsLoading] = useState(true)
	const [isError, setIsError] = useState(false)
	const [props, setProps] = useState<Parameters<typeof StatWithButtonsWidget>[0]>()

	useEffect(() => {
		setIsLoading(true)
		fetch(endpoint)
			.then((res) => res.json())
			.then((data) => {
				console.log(data)
				setIsLoading(false)
				setProps(data)
			})
			.catch(() => setIsError(true))
	}, [endpoint])

	const variant = useContext(BackdropBlurVariantContext)

	if (isError) {
		return <div className={widgetContainerCva({variant})}>Error</div>
	}

	if (isLoading) {
		return <div className={widgetContainerCva({variant})}></div>
	}

	return <StatWithButtonsWidget {...props} />
}

export function StatWithButtonsWidget({
	title,
	value,
	valueSub,
	buttons,
}: {
	title?: string
	value?: string
	valueSub?: string
	buttons?: {
		icon: string
		title: string
		endpoint: string
	}[]
}) {
	const variant = useContext(BackdropBlurVariantContext)
	return (
		<div className={widgetContainerCva({variant})}>
			<StatText title={title} value={value} valueSub={valueSub} />
			<div className='flex-1' />
			<div className='grid grid-cols-2 gap-1'>
				{buttons?.map((button) => (
					// Not using endpoint for `key` in case user wants two buttons to link to the same endpoint for some reason
					<WidgetButtonLink key={button.title} href={button.endpoint}>
						{button.icon && <img src={button.icon} alt='icon' className='mr-1 h-4 w-4' width={16} height={16} />}
						<span className='truncate'>{button.title}</span>
					</WidgetButtonLink>
				))}
			</div>
		</div>
	)
}

function WidgetButtonLink({href, children}: {href: string; children: ReactNode}) {
	return (
		<a
			href={href}
			className='flex h-[30px] cursor-pointer select-none items-center justify-center rounded-full bg-white/5 px-2.5 text-12 font-medium transition-colors hover:bg-white/10 active:bg-white/5'
		>
			{children}
		</a>
	)
}

export function FourUpWidget() {
	const variant = useContext(BackdropBlurVariantContext)
	return (
		<div className={cn(widgetContainerCva({variant}), 'grid grid-cols-2 grid-rows-2 p-2.5')}>
			<FourUpItem title='Connections' value='10' valueSub='peers' />
			<FourUpItem title='Mempool' value='35' valueSub='MB' />
			<FourUpItem title='Hashrate' value='366' valueSub='EH/s' />
			<FourUpItem title='Blockchain size' value='563' valueSub='GB' />
		</div>
	)
}

function FourUpItem({title, value, valueSub}: {title?: string; value?: string; valueSub?: string}) {
	return (
		<div className='flex flex-col justify-center rounded-12 bg-white/5 px-5'>
			<p
				className={cn(
					widgetTextCva({
						opacity: 'secondary',
					}),
					'text-11',
				)}
				title={value}
			>
				{title}
			</p>
			<p className={widgetTextCva()}>
				{value} <span className={widgetTextCva({opacity: 'tertiary'})}>{valueSub}</span>
			</p>
		</div>
	)
}

export function ActionsWidget() {
	const variant = useContext(BackdropBlurVariantContext)
	return (
		<div className={cn(widgetContainerCva({variant}), 'relative pb-2.5')}>
			<ActionItem emoji='🔒' title='Change password' />
			<div className='origin-left scale-90 opacity-60'>
				<ActionItem emoji='🔒' title='Change password' />
			</div>
			<div className='origin-left scale-[85%] opacity-40'>
				<ActionItem emoji='🔒' title='Change password' />
			</div>
			<div className='origin-left scale-[80%] opacity-20'>
				<ActionItem emoji='🔒' title='Change password' />
			</div>
			<div className='absolute bottom-3 right-3 text-[33px] font-semibold leading-none -tracking-3 opacity-10'>123</div>
		</div>
	)
}

function ActionItem({emoji, title}: {emoji: string; title?: string}) {
	return (
		<div className='flex items-center gap-1.5'>
			<div className='flex h-5 w-5 items-center justify-center rounded-5 bg-white/5'>{emoji}</div>
			<p className={widgetTextCva()}>{title}</p>
		</div>
	)
}

export function NotificationsWidget() {
	const variant = useContext(BackdropBlurVariantContext)
	return (
		<div className={cn(widgetContainerCva({variant}), 'justify-between p-4')}>
			<NotificationItem />
			<hr className='border-white/5' />
			<NotificationItem />
		</div>
	)
}

function NotificationItem() {
	return (
		<div className='text-12 leading-tight'>
			<div className='opacity-20'>12:34 pm · Sep 9</div>
			<p className='line-clamp-2 opacity-80'>
				✨ Introducing a new feature in our Nostr Relay app for Umbrel. Now you can sync your private relay on Umbrel
				with public relays, and back up past & future Nostr activity, even if the connection between your client & your
				private relay goes down
			</p>
		</div>
	)
}
