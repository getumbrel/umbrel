import {Dialog, DialogClose, DialogContent, DialogOverlay, DialogPortal} from '@radix-ui/react-dialog'
import {ForwardedRef, forwardRef} from 'react'
import {RiCloseLine} from 'react-icons/ri'

import {Button} from '@/shadcn-components/ui/button'
import {dialogContentClass, dialogOverlayClass} from '@/shadcn-components/ui/shared/dialog'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

import {afterDelayedClose} from '../../utils/dialog'
import {DialogMounter} from '../dialog-mounter'

export const immersiveDialogTitleClass = tw`text-24 font-bold leading-none -tracking-4 text-white/80`
export const immersiveDialogDescriptionClass = tw`text-15 font-normal leading-tight -tracking-2 text-white/40`

export function ImmersiveDialogSeparator() {
	return <hr className='w-full border-white/10' />
}

export function ImmersiveDialog({children, onClose}: {children: React.ReactNode; onClose?: () => void}) {
	return (
		<DialogMounter>
			<Dialog defaultOpen onOpenChange={afterDelayedClose(onClose)}>
				<DialogPortal>
					<ImmersiveDialogOverlay />
					{/* shell */}
					<DialogContent className={cn(dialogContentClass, immersiveContentSizeClass, 'p-0 px-4')}>
						<div className='umbrel-dialog-fade-scroller flex h-full flex-col gap-6 overflow-y-auto px-4 py-8'>
							{children}
						</div>
						<ImmersiveDialogClose />
					</DialogContent>
				</DialogPortal>
			</Dialog>
		</DialogMounter>
	)
}

// TODO: consider splitting this into two components, one for the left side and one for the right side
export function ImmersiveDialogSplit({
	children,
	leftChildren,
	onClose,
}: {
	children: React.ReactNode
	leftChildren: React.ReactNode
	onClose?: () => void
}) {
	return (
		<DialogMounter>
			<Dialog defaultOpen onOpenChange={afterDelayedClose(onClose)}>
				<DialogPortal>
					<ImmersiveDialogOverlay />
					{/* shell */}
					<DialogContent
						className={cn(
							dialogContentClass,
							immersiveContentSizeClass,
							'flex flex-row justify-between gap-0 bg-black/40 p-0',
						)}
					>
						<div className='hidden w-[210px] flex-col items-center justify-center md:flex'>{leftChildren}</div>
						<div className='flex-1 rounded-20 bg-dialog-content/70 px-4 md:rounded-l-none md:rounded-r-20'>
							<div className='umbrel-dialog-fade-scroller flex h-full flex-col gap-6 overflow-y-auto px-4 py-8'>
								{children}
							</div>
						</div>
						<ImmersiveDialogClose />
					</DialogContent>
				</DialogPortal>
			</Dialog>
		</DialogMounter>
	)
}

const immersiveContentSizeClass = tw`top-[calc(50%-30px)] max-h-[800px] w-[calc(100%-40px)] max-w-[800px] h-[calc(100dvh-90px)]`

function ForwardedImmersiveDialogOverlay(props: unknown, ref: ForwardedRef<HTMLDivElement>) {
	return <DialogOverlay ref={ref} className={cn(dialogOverlayClass, 'bg-black/30 backdrop-blur-xl')} />
}

const ImmersiveDialogOverlay = forwardRef(ForwardedImmersiveDialogOverlay)

function ImmersiveDialogClose() {
	return (
		<div className='absolute left-1/2 top-full mt-5 -translate-x-1/2'>
			{/* Note, because this parent has a backdrop, this button won't have a backdrop */}
			<DialogClose asChild>
				<Button
					size='icon'
					className='dialog-shadow h-[36px] w-[36px] border-none bg-dialog-content backdrop-blur-2xl hover:bg-dialog-content active:bg-dialog-content'
					style={{
						boxShadow: '0px 32px 32px 0px rgba(0, 0, 0, 0.32), 1px 1px 1px 0px rgba(255, 255, 255, 0.08) inset',
					}}
				>
					<RiCloseLine className='h-4 w-4' />
				</Button>
			</DialogClose>
		</div>
	)
}
