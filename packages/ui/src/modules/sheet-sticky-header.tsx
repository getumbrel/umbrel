// NOTE: in the future, may want to use this for dialogs, but for now only works for sheets

import {Portal} from '@radix-ui/react-portal'
import {ComponentPropsWithoutRef, createContext, useContext, useEffect, useState} from 'react'

import {cn} from '@/shadcn-lib/utils'

// In the future, the child that sets the header content will should be responsible for this
const SCROLL_THRESHOLD = 110
export const SHEET_HEADER_ID = 'sheet-header-root-id'

type ContextT = {
	showStickyHeader: boolean
	hasStickyHeader: boolean
	setHasStickyHeader: (has: boolean) => void
}

const StickyContext = createContext<ContextT | null>(null)

export function SheetStickyHeaderProvider({
	children,
	scrollRef,
}: {
	children: React.ReactNode
	scrollRef: React.RefObject<HTMLDivElement>
}) {
	const [hasStickyHeader, setHasStickyHeader] = useState(false)
	const [showStickyHeader, setShowStickyHeader] = useState(false)

	useEffect(() => {
		const el = scrollRef.current
		const scrollHandler = () => {
			const scrollTop = scrollRef.current?.scrollTop ?? 0
			// console.log('scroll', scrollTop)
			if (scrollTop > SCROLL_THRESHOLD && hasStickyHeader) {
				setShowStickyHeader(true)
			} else {
				setShowStickyHeader(false)
			}
		}

		el?.addEventListener('scroll', scrollHandler, {passive: true})

		return () => el?.removeEventListener('scroll', scrollHandler)
	}, [scrollRef, hasStickyHeader])

	return (
		<StickyContext.Provider value={{showStickyHeader, hasStickyHeader, setHasStickyHeader}}>
			{children}
		</StickyContext.Provider>
	)
}

export function useSheetStickyHeader() {
	const ctx = useContext(StickyContext)
	if (!ctx) throw new Error('useSheetStickyHeader must be used within SheetStickyHeaderProvider')

	return ctx
}

// ---

export function SheetStickyHeader(props: ComponentPropsWithoutRef<'div'>) {
	const {setHasStickyHeader} = useSheetStickyHeader()

	useEffect(() => {
		setHasStickyHeader(true)
		return () => setHasStickyHeader(false)
	}, [setHasStickyHeader])

	return <Portal container={document.getElementById(SHEET_HEADER_ID)} {...props} />
}

export function SheetStickyHeaderTarget() {
	const {showStickyHeader} = useSheetStickyHeader()

	return (
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
	)
}
