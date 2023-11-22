import {AnimatePresence, motion} from 'framer-motion'
import {ReactNode, useState} from 'react'
import {useTimeout} from 'react-use'
import {uniq} from 'remeda'

import {useInstalledApps} from '@/hooks/use-installed-apps'
import {DockSpacer} from '@/modules/desktop/dock'
import {BackdropBlurVariantContext, WidgetConfig, widgetConfigToWidget} from '@/modules/desktop/widgets'
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/shadcn-components/ui/sheet'
import {cn} from '@/shadcn-lib/utils'

const widgetConfigs = [
	{
		appId: 'settings',
		widgets: [
			{
				type: 'stat-with-progress',
				endpoint: '/widgets/settings/storage-stat.json',
			},
			{
				type: 'stat-with-progress',
				endpoint: '/widgets/settings/memory-stat.json',
			},
			{
				type: 'three-up',
				endpoint: '/widgets/settings/system-stats.json',
			},
		],
	},
	{
		appId: 'bitcoin',
		widgets: [
			{
				type: 'stat-with-progress',
				endpoint: '/widgets/bitcoin/sync.json',
			},
			{
				type: 'stat-with-buttons',
				endpoint: '/widgets/bitcoin/balance-and-transact.json',
			},
			{
				type: 'four-up',
				endpoint: '/widgets/bitcoin/stats.json',
			},
		],
	},
	{
		appId: 'lightning',
		widgets: [
			{
				type: 'stat-with-buttons',
				endpoint: '/widgets/lightning/balance-and-transact.json',
			},
		],
	},
	{
		appId: 'nostr-relay',
		widgets: [
			{
				type: 'actions',
				endpoint: '/widgets/nostr-relay/actions.json',
			},
			{
				type: 'notifications',
				endpoint: '/widgets/nostr-relay/notifications.json',
			},
		],
	},
] as const satisfies readonly {
	appId: string
	widgets: readonly WidgetConfig[]
}[]

const MAX_WIDGETS = 3

export function WidgetSelector({
	open,
	onOpenChange,
	selectedWidgets = [],
	onSelectedWidgetsChange,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	selectedWidgets?: WidgetConfig[]
	onSelectedWidgetsChange?: (widgets: WidgetConfig[]) => void
}) {
	const [selectedTooMany, setSelectedTooMany] = useState(false)
	const {allAppsKeyed, isLoading} = useInstalledApps()

	// Delay until after `usePager` has injected CSS vars
	const [isReady] = useTimeout(300)
	if (isLoading) return null
	if (!isReady()) return null

	return (
		<>
			{open && (
				<motion.div
					initial={{
						opacity: 0,
						y: 40,
					}}
					animate={{
						opacity: 1,
						y: 0,
					}}
					transition={{
						duration: 0.2,
						ease: 'easeOut',
					}}
					className={cn(
						'absolute top-[50px] z-50 flex justify-center gap-[var(--app-x-gap)]',
						selectedTooMany && 'animate-shake',
					)}
				>
					<AnimatePresence>
						{selectedWidgets.map((widget) => {
							return (
								<motion.div
									key={widget.endpoint}
									layout
									initial={{
										opacity: 1,
										y: -20,
									}}
									animate={{
										opacity: 1,
										y: 0,
									}}
									exit={{
										opacity: 0,
										y: 20,
									}}
									transition={{
										type: 'spring',
										stiffness: 500,
										damping: 30,
									}}
								>
									{widgetConfigToWidget(widget)}
								</motion.div>
							)
						})}
					</AnimatePresence>
				</motion.div>
			)}
			<WidgetSheet open={open} onOpenChange={onOpenChange}>
				{widgetConfigs.map(({appId, widgets}) => {
					return (
						<WidgetSection key={appId} iconSrc={allAppsKeyed[appId].icon} title={allAppsKeyed[appId].name}>
							{widgets.map((widget) => {
								return (
									<WidgetChecker
										key={widget.endpoint}
										checked={selectedWidgets.map((w) => w.endpoint).includes(widget.endpoint)}
										onCheckedChange={(c) => {
											if (selectedWidgets.length >= MAX_WIDGETS && c) {
												setSelectedTooMany(true)
												setTimeout(() => setSelectedTooMany(false), 500)
												return
											}
											setSelectedTooMany(false)
											if (selectedWidgets.map((w) => w.endpoint).includes(widget.endpoint)) {
												onSelectedWidgetsChange?.(selectedWidgets.filter((w) => w.endpoint !== widget.endpoint))
											} else {
												onSelectedWidgetsChange?.(uniq([...selectedWidgets, widget]))
											}
											console.log(widget.endpoint)
										}}
									>
										{widgetConfigToWidget(widget)}
									</WidgetChecker>
								)
							})}
						</WidgetSection>
					)
				})}
			</WidgetSheet>
		</>
	)
}

function WidgetSheet({
	open,
	onOpenChange,
	children,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	children: ReactNode
}) {
	return (
		<BackdropBlurVariantContext.Provider value='default'>
			<Sheet open={open} onOpenChange={onOpenChange} modal={false}>
				<SheetContent
					className='mx-auto h-[calc(100dvh-var(--widget-labeled-h)-50px)] max-w-[1040px]'
					onContextMenu={(e) => e.preventDefault()}
					onInteractOutside={(e) => e.preventDefault()}
					backdrop={<div className='fixed inset-0 z-30' onClick={() => onOpenChange(false)} />}
				>
					<div
						className={cn(
							'umbrel-dialog-fade-scroller flex h-full flex-col items-start gap-[50px] overflow-y-auto px-10 pt-16 opacity-0',
							'opacity-100 duration-100 animate-in fade-in',
						)}
					>
						<SheetHeader>
							<SheetTitle>Select up to 3 widgets</SheetTitle>
						</SheetHeader>
						{children}
						<DockSpacer />
					</div>
				</SheetContent>
			</Sheet>
		</BackdropBlurVariantContext.Provider>
	)
}

function WidgetSection({iconSrc, title, children}: {iconSrc: string; title: string; children: ReactNode}) {
	return (
		<>
			<div className='flex items-center gap-3'>
				<img alt='icon' src={iconSrc} width={36} height={36} className='rounded-8' />
				<h3 className='text-20 font-semibold leading-tight'>{title}</h3>
			</div>
			<div className='flex flex-row flex-wrap gap-x-[var(--app-x-gap)] gap-y-[var(--app-y-gap)]'>{children}</div>
		</>
	)
}

function WidgetChecker({
	children,
	checked = false,
	onCheckedChange,
}: {
	children: ReactNode
	checked?: boolean
	onCheckedChange?: (checked: boolean) => void
}) {
	return (
		<div className='relative'>
			{children}
			{checked && (
				<div className='absolute right-0 top-0 -translate-y-1/3 translate-x-1/3'>
					<img src='/check.svg' />
					{/* <div className="w-10 h-10 bg-brand rounded-full" /> */}
				</div>
			)}
			<button
				className='absolute left-0 top-0 h-full w-full outline-none'
				onClick={() => onCheckedChange?.(!checked)}
			/>
		</div>
	)
}
