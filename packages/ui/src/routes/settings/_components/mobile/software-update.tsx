import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button, buttonVariants} from '@/shadcn-components/ui/button'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {cn} from '@/shadcn-lib/utils'
import {useDialogOpenProps} from '@/utils/dialog'

export function SoftwareUpdateDrawer() {
	const title = 'Software update'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('software-update')

	return (
		<Drawer {...dialogProps}>
			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>Check for latest software version and upgrade to it</DrawerDescription>
				</DrawerHeader>
				<div className='flex flex-col items-center py-8'>
					<img src='/figma-exports/umbrel-ios.png' className='h-[96px] w-[96px]' />
					<div className='mb-4' />
					<p className='text-15 -tracking-4'>umbrelOS 1.0-beta</p>
					<p className='text-12 -tracking-2 opacity-50'>Currently running</p>
					{/* Make it look like a button, but non-interactive */}
				</div>
				<DrawerFooter>
					<div className={cn(buttonVariants({size: 'dialog'}), 'pointer-events-none border-none shadow-none')}>
						You’re on the latest version
					</div>
					<Button variant='primary' size='dialog'>
						Check for updates
					</Button>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	)
}
