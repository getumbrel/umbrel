import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/components/ui/drawer'
import {useIsPhone} from '@/hooks/use-is-mobile'

// A long list stops at a comfortable height instead of filling a tall tablet
function WindowContent({
	children,
	withScroll,
}: {
	children: React.ReactNode
	fullHeight?: boolean
	withScroll?: boolean
}) {
	return (
		<DialogContent className='max-h-[min(800px,calc(100%-16px))] px-5 py-6'>
			{withScroll ? <DrawerScroller>{children}</DrawerScroller> : children}
		</DialogContent>
	)
}

const drawerParts = {
	Root: Drawer,
	Content: DrawerContent,
	Header: DrawerHeader,
	Title: DrawerTitle,
	Description: DrawerDescription,
	Scroller: DrawerScroller,
}

const windowParts = {
	Root: Dialog,
	Content: WindowContent,
	Header: DialogHeader,
	Title: DialogTitle,
	Description: DialogDescription,
	Scroller: DrawerScroller,
}

// For a screen that lays out the same either way: a drawer on phones, and a
// centred window wherever there's room for one
export function useDrawerOrDialog() {
	return useIsPhone() ? drawerParts : windowParts
}
