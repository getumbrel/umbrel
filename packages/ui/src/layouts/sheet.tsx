import {Suspense, useRef, useState} from 'react'
import {Outlet, useNavigate} from 'react-router-dom'

import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {useScrollRestoration} from '@/hooks/use-scroll-restoration'
import {DockSpacer} from '@/modules/desktop/dock'
import {SheetStickyHeaderProvider, SheetStickyHeaderTarget, useSheetStickyHeader} from '@/modules/sheet-sticky-header'
import {SheetFixedTarget} from '@/modules/sheet-top-fixed'
import {Sheet, SheetContent} from '@/shadcn-components/ui/sheet'
import {ScrollArea} from '@/shadcn-components/ui/sheet-scroll-area'
import {useAfterDelayedClose} from '@/utils/dialog'

export function SheetLayout() {
	const navigate = useNavigate()

	const [open, setOpen] = useState(true)

	const scrollRef = useRef<HTMLDivElement>(null)

	useScrollRestoration(scrollRef)

	useAfterDelayedClose(open, () => navigate('/'))

	return (
		<Sheet open={open} onOpenChange={setOpen} modal={false}>
			<SheetStickyHeaderProvider scrollRef={scrollRef}>
				<SheetContent
					className='mx-auto h-[calc(100dvh-var(--sheet-top))] max-w-[1320px] md:w-[calc(100vw-25px-25px)] lg:h-[calc(100dvh-60px)] lg:w-[calc(100vw-60px-60px)]'
					backdrop={
						open && (
							<div
								data-state={open ? 'open' : 'closed'}
								className='fixed inset-0 z-30'
								onClick={() => setOpen(false)}
							/>
						)
					}
					closeButton={<SheetCloseButton />}
					onInteractOutside={(e) => e.preventDefault()}
					onEscapeKeyDown={(e) => e.preventDefault()}
				>
					<SheetFixedTarget />
					<SheetStickyHeaderTarget />
					<ScrollArea className='h-full rounded-t-20' viewportRef={scrollRef}>
						<div className='flex flex-col gap-5 px-3 pt-6 md:px-[70px] md:pt-12'>
							<Suspense>
								<Outlet />
							</Suspense>
							<DockSpacer className='mt-4' />
						</div>
					</ScrollArea>
				</SheetContent>
			</SheetStickyHeaderProvider>
		</Sheet>
	)
}

function SheetCloseButton() {
	const {showStickyHeader} = useSheetStickyHeader()

	if (showStickyHeader) return null

	return <DialogCloseButton className='absolute right-2.5 top-2.5 z-50' />
}
