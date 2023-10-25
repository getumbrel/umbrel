import {useState} from 'react'
import {Outlet, useNavigate} from 'react-router-dom'

import {useAfterDelayedClose} from '@/components/client-layout'
import {DockSpacer} from '@/components/desktop/dock'
import {DialogMounter} from '@/components/dialog-mounter'
import {Sheet, SheetContent} from '@/shadcn-components/ui/sheet'

export function SheetLayout() {
	const navigate = useNavigate()
	const [open, setOpen] = useState(true)

	useAfterDelayedClose(open, () => navigate('/'))

	return (
		<DialogMounter>
			<Sheet open={open} onOpenChange={setOpen} modal={false}>
				<SheetContent
					className='mx-auto h-[calc(100dvh-60px)] max-w-[1320px] lg:w-[calc(100vw-60px-60px)]'
					backdrop={
						open && (
							<div
								data-state={open ? 'open' : 'closed'}
								className='bg-background/80 fixed inset-0 z-30 backdrop-blur-xl'
								onClick={() => setOpen(false)}
							/>
						)
					}
					onContextMenu={(e) => e.preventDefault()}
					onInteractOutside={(e) => e.preventDefault()}
				>
					<div className='umbrel-dialog-fade-scroller flex h-full flex-col gap-5 overflow-y-auto pt-12 md:px-8'>
						<Outlet />
						<DockSpacer className='mt-4' />
					</div>
				</SheetContent>
			</Sheet>
		</DialogMounter>
	)
}
