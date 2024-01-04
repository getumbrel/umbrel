import {Suspense, useEffect, useRef, useState} from 'react'
import {Outlet, useNavigate} from 'react-router-dom'

import {SHEET_HEADER_ID} from '@/constants'
import {useScrollRestoration} from '@/hooks/use-scroll-restoration'
import {DockSpacer} from '@/modules/desktop/dock'
import {Sheet, SheetContent} from '@/shadcn-components/ui/sheet'
import {cn} from '@/shadcn-lib/utils'
import {useAfterDelayedClose} from '@/utils/dialog'

// For now, matching the height of the app-page header
// In the future, the child that sets the header content will should be responsible for this
const SCROLL_THRESHOLD = 110

function useStickyHeader({scrollRef}: {scrollRef: React.RefObject<HTMLDivElement>}) {
	const [showStickyHeader, setShowStickyHeader] = useState(false)

	useEffect(() => {
		const el = scrollRef.current
		const scrollHandler = () => {
			const scrollTop = scrollRef.current?.scrollTop ?? 0
			console.log('scroll', scrollTop)
			if (scrollTop > SCROLL_THRESHOLD) {
				setShowStickyHeader(true)
			} else {
				setShowStickyHeader(false)
			}
		}

		el?.addEventListener('scroll', scrollHandler, {passive: true})

		return () => el?.removeEventListener('scroll', scrollHandler)
	}, [scrollRef])

	return showStickyHeader
}

export function SheetLayout() {
	const navigate = useNavigate()

	const [open, setOpen] = useState(true)

	const scrollRef = useRef<HTMLDivElement>(null)

	const showStickyHeader = useStickyHeader({scrollRef})

	useScrollRestoration(scrollRef)

	useAfterDelayedClose(open, () => navigate('/'))

	return (
		<Sheet open={open} onOpenChange={setOpen} modal={false}>
			<SheetContent
				className='mx-auto h-[calc(100dvh-16px)] max-w-[1320px] pb-6 md:w-[calc(100vw-25px-25px)] lg:h-[calc(100dvh-60px)] lg:w-[calc(100vw-60px-60px)]'
				backdrop={
					open && (
						<div data-state={open ? 'open' : 'closed'} className='fixed inset-0 z-30' onClick={() => setOpen(false)} />
					)
				}
				showClose={!showStickyHeader}
				onInteractOutside={(e) => e.preventDefault()}
				onEscapeKeyDown={(e) => e.preventDefault()}
			>
				<div
					id={SHEET_HEADER_ID}
					className={cn(
						'invisible absolute inset-x-0 top-0 z-50 h-[76px] rounded-t-20 border-b border-white/10 bg-black/50 px-5 backdrop-blur-xl empty:hidden',
						showStickyHeader && 'visible',
					)}
					style={{
						boxShadow: '2px 2px 2px 0px #FFFFFF0D inset',
					}}
				/>
				<div
					className='umbrel-dialog-fade-scroller flex h-full flex-col gap-5 overflow-y-auto px-3 pt-6 md:px-[70px] md:pt-12'
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
