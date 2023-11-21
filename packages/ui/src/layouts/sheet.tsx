import {Suspense, useRef, useState} from 'react'
import {Outlet, useNavigate} from 'react-router-dom'

import {useScrollRestoration} from '@/hooks/use-scroll-restoration'
import {DockSpacer} from '@/modules/desktop/dock'
import {Sheet, SheetContent} from '@/shadcn-components/ui/sheet'
import {useAfterDelayedClose} from '@/utils/dialog'

export function SheetLayout() {
	const navigate = useNavigate()

	const [open, setOpen] = useState(true)

	const scrollRef = useRef<HTMLDivElement>(null)

	useScrollRestoration(scrollRef)

	useAfterDelayedClose(open, () => navigate('/'))

	return (
		<Sheet open={open} onOpenChange={setOpen} modal={false}>
			<SheetContent
				className='mx-auto h-[calc(100dvh-16px)] max-w-[1320px] pb-6 lg:h-[calc(100dvh-60px)] lg:w-[calc(100vw-60px-60px)]'
				backdrop={
					open && (
						<div
							data-state={open ? 'open' : 'closed'}
							className='fixed inset-0 z-30 backdrop-blur-xl contrast-more:bg-neutral-600 contrast-more:backdrop-blur-none'
							onClick={() => setOpen(false)}
						/>
					)
				}
				onContextMenu={(e) => e.preventDefault()}
				onInteractOutside={(e) => e.preventDefault()}
				onEscapeKeyDown={(e) => e.preventDefault()}
			>
				<div
					className='umbrel-dialog-fade-scroller flex h-full flex-col gap-5 overflow-y-auto pt-12 md:px-8'
					ref={scrollRef}
				>
					<Suspense>
						<Outlet />
					</Suspense>
					<DockSpacer className='mt-4' />
				</div>
			</SheetContent>
		</Sheet>
	)
}
