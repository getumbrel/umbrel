import {AnimatePresence, motion} from 'framer-motion'
import {ReactNode} from 'react'
import {useTimeout} from 'react-use'

import {WidgetCheckIcon} from '@/assets/widget-check-icon'
import {AppIcon} from '@/components/app-icon'
import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {useWidgets} from '@/hooks/use-widgets'
import {DockSpacer} from '@/modules/desktop/dock'
import {Widget} from '@/modules/widgets'
import {BackdropBlurVariantContext} from '@/modules/widgets/shared/backdrop-blur-context'
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/shadcn-components/ui/sheet'
import {ScrollArea} from '@/shadcn-components/ui/sheet-scroll-area'
import {cn} from '@/shadcn-lib/utils'

export function WidgetSelector({open, onOpenChange}: {open: boolean; onOpenChange: (open: boolean) => void}) {
	// Delay until after `usePager` has injected CSS vars
	const [isReady] = useTimeout(300)

	const widgets = useWidgets()

	if (!isReady()) return null

	const {availableWidgets, toggleSelected, selected, selectedTooMany} = widgets

	const selectedH = selected.length == 0 ? 'var(--sheet-top)' : `calc(var(--widget-h) + 8vh)`

	return (
		<>
			{open && (
				// Don't make this take up full width because clicking outside should close the widget selector
				// `pointer-events-none` because we want clicking outside the sheet to close the sheet, not interact with the widget
				<div className='pointer-events-none absolute left-1/2 top-0 z-50 -translate-x-1/2 max-lg:scale-[85%] max-md:scale-[65%]'>
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
										<Widget appId={widget.app.id} config={widget} />
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
										<Widget appId={appId} config={widget} />
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
					closeButton={<DialogCloseButton className='absolute right-2.5 top-2.5 z-50' />}
				>
					<ScrollArea className='h-full rounded-t-20'>
						<div
							className={cn(
								'flex h-full flex-col items-start gap-5 px-4 pt-6 opacity-0 md:gap-[50px] md:px-[80px] md:pt-12',
								'opacity-100 duration-100 animate-in fade-in',
							)}
						>
							<SheetHeader>
								<SheetTitle>Select up to 3 widgets</SheetTitle>
							</SheetHeader>
							{children}
							<DockSpacer />
						</div>
					</ScrollArea>
				</SheetContent>
			</Sheet>
		</BackdropBlurVariantContext.Provider>
	)
}

function WidgetSection({iconSrc, title, children}: {iconSrc: string; title: string; children: ReactNode}) {
	return (
		<>
			<div className='flex items-center gap-3'>
				<AppIcon src={iconSrc} size={36} className='rounded-8' />
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
				<div className='absolute right-0 top-0 -translate-y-1/3 translate-x-1/3 text-brand'>
					<WidgetCheckIcon className='max-sm:scale-75' />
				</div>
			)}
			<button
				className='absolute left-0 top-0 h-full w-full outline-none'
				onClick={() => onCheckedChange?.(!checked)}
			/>
		</div>
	)
}
