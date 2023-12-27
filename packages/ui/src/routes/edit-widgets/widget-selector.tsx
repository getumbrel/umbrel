import {AnimatePresence, motion} from 'framer-motion'
import {ReactNode} from 'react'
import {useTimeout} from 'react-use'

import {useWidgets} from '@/hooks/use-widgets'
import {DockSpacer} from '@/modules/desktop/dock'
import {BackdropBlurVariantContext, widgetConfigToWidget} from '@/modules/desktop/widgets'
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/shadcn-components/ui/sheet'
import {cn} from '@/shadcn-lib/utils'

export function WidgetSelector({open, onOpenChange}: {open: boolean; onOpenChange: (open: boolean) => void}) {
	// Delay until after `usePager` has injected CSS vars
	const [isReady] = useTimeout(300)

	const widgets = useWidgets()

	if (!isReady()) return null

	const {availableWidgets, toggleSelected, selected, selectedTooMany} = widgets

	const selectedH = selected.length == 0 ? '4vh' : `calc(var(--widget-h) + 8vh)`

	return (
		<>
			{open && (
				// Don't make this take up full width because clicking outside should close the widget selector
				<div className='absolute left-1/2 top-0 z-50 -translate-x-1/2 max-lg:scale-[85%] max-md:scale-[65%]'>
					{/* <div className='absoulte top-0 grid h-[var(--widget-h)] w-full place-items-center whitespace-nowrap'>
						No widgets selected
					</div> */}
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
						className={cn('flex items-center gap-[var(--app-x-gap)]', selectedTooMany && 'animate-shake')}
						style={{height: selectedH}}
					>
						<AnimatePresence>
							{selected.map((widget) => {
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
				</div>
			)}
			<WidgetSheet open={open} onOpenChange={onOpenChange} selectedCssHeight={selectedH}>
				{availableWidgets.map(({appId, icon, name, widgets}) => {
					return (
						<WidgetSection key={appId} iconSrc={icon} title={name}>
							{widgets?.map((widget) => {
								return (
									<WidgetChecker
										key={widget.endpoint}
										checked={selected.map((w) => w.endpoint).includes(widget.endpoint)}
										onCheckedChange={(checked) => toggleSelected(widget, checked)}
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
	selectedCssHeight,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	children: ReactNode
	selectedCssHeight: string
}) {
	return (
		<BackdropBlurVariantContext.Provider value='default'>
			<Sheet open={open} onOpenChange={onOpenChange} modal={false}>
				<SheetContent
					className='mx-auto max-w-[1040px] transition-[height]'
					onInteractOutside={(e) => e.preventDefault()}
					style={{
						height: `calc(100dvh - ${selectedCssHeight})`,
					}}
					backdrop={<div className='fixed inset-0 z-30' onClick={() => onOpenChange(false)} />}
				>
					<div
						className={cn(
							'umbrel-dialog-fade-scroller flex h-full flex-col items-start gap-5 overflow-y-auto pt-6 opacity-0 md:gap-[50px] md:px-8 md:pt-12',
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
			<div className='flex flex-row flex-wrap gap-[20px]'>{children}</div>
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
					<img src='/check.svg' className='max-sm:w-6' />
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
