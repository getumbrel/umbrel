import {DialogPortal} from '@radix-ui/react-dialog'
import {useState} from 'react'
import {range} from 'remeda'

import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogOverlay,
	ImmersiveDialogSplitContent,
	ImmersiveDialogTrigger,
} from '@/components/ui/immersive-dialog'
import {toast} from '@/components/ui/toast'
import {Wallpaper} from '@/providers/wallpaper'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/shadcn-components/ui/alert-dialog'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/shadcn-components/ui/dialog'
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from '@/shadcn-components/ui/drawer'

export default function DialogExamples() {
	return (
		<>
			<Wallpaper />
			<div className='z-0 flex h-full flex-wrap gap-2'>
				<DialogExample />
				<AlertDialogExample />
				<DrawerExample />
				<ImmersiveDialogExample />
				<ImmersiveDialogSplitExample />
			</div>
		</>
	)
}

function DialogExample() {
	const [open, setOpen] = useState(false)

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size='lg'>Open Dialog</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						Lorem ipsum dolor sit amet consectetur adipisicing elit. Illo aspernatur in consequatur illum quos non
						voluptatum quidem, laboriosam natus praesentium soluta, aliquam fugit harum dolore exercitationem saepe
						nihil ad quia.
					</DialogTitle>
					<DialogDescription>
						Lorem ipsum dolor sit amet consectetur adipisicing elit. Illo aspernatur in consequatur illum quos non
						voluptatum quidem, laboriosam natus praesentium soluta, aliquam fugit harum dolore exercitationem saepe
						nihil ad quia.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button size='dialog' onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						size='dialog'
						variant='primary'
						onClick={() => {
							setOpen(false)
							toast('Continue!')
						}}
					>
						Continue
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function AlertDialogExample() {
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button size='lg'>Open Alert Dialog</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						Lorem ipsum dolor sit amet consectetur adipisicing elit. Illo aspernatur in consequatur illum quos non
						voluptatum quidem, laboriosam natus praesentium soluta, aliquam fugit harum dolore exercitationem saepe
						nihil ad quia.
					</AlertDialogTitle>
					<AlertDialogDescription>
						Lorem ipsum dolor sit amet consectetur adipisicing elit. Soluta perspiciatis facilis labore! Odio at nulla
						corporis, incidunt molestias, voluptatem rerum iusto voluptates ea enim recusandae ab dicta nihil
						perferendis illo.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction onClick={() => toast('Continue!')}>Continue</AlertDialogAction>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}

function DrawerExample() {
	return (
		<Drawer>
			<DrawerTrigger asChild>
				<Button size='lg'>Open Drawer</Button>
			</DrawerTrigger>
			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle>Account</DrawerTitle>
					<DrawerDescription>Your display name & Umbrel password</DrawerDescription>
				</DrawerHeader>
				<DrawerFooter>
					<DrawerClose asChild autoFocus>
						<Button size='dialog' className='w-full'>
							Cancel
						</Button>
					</DrawerClose>
					<Button size='dialog' variant='primary'>
						Submit
					</Button>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	)
}

function ImmersiveDialogExample() {
	return (
		<ImmersiveDialog>
			<ImmersiveDialogTrigger asChild>
				<Button size='lg'>Open Immersive Dialog</Button>
			</ImmersiveDialogTrigger>
			<DialogPortal>
				<ImmersiveDialogOverlay />
				<ImmersiveDialogContent showScroll>
					{range(0, 10).map((i) => (
						<p key={i}>
							Lorem ipsum dolor sit amet consectetur adipisicing elit. Modi, nisi dolore quasi ea quos corporis ipsa
							consectetur, eligendi accusamus qui commodi sunt explicabo cum. Accusamus amet tempore exercitationem eos
							totam.
						</p>
					))}
				</ImmersiveDialogContent>
			</DialogPortal>
		</ImmersiveDialog>
	)
}

function ImmersiveDialogSplitExample() {
	return (
		<ImmersiveDialog>
			<ImmersiveDialogTrigger asChild>
				<Button size='lg'>Open Immersive Dialog Split</Button>
			</ImmersiveDialogTrigger>
			<ImmersiveDialogSplitContent side={<>Hello</>}>
				{range(0, 3).map((i) => (
					<p key={i}>
						Lorem ipsum dolor sit amet consectetur adipisicing elit. Modi, nisi dolore quasi ea quos corporis ipsa
						consectetur, eligendi accusamus qui commodi sunt explicabo cum. Accusamus amet tempore exercitationem eos
						totam.
					</p>
				))}

				<div className='flex-1' />

				<Button size='dialog' variant='primary' className='self-start justify-self-end'>
					Continue
				</Button>
			</ImmersiveDialogSplitContent>
		</ImmersiveDialog>
	)
}
