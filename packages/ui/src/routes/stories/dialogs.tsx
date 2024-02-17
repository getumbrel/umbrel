import {useState} from 'react'

import {ImmersiveDialog, ImmersiveDialogContent, ImmersiveDialogTrigger} from '@/components/ui/immersive-dialog'
import {toast} from '@/components/ui/toast'
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
		<div>
			<DialogExample />
			<AlertDialogExample />
			<DrawerExample />
			<ImmersiveDialogExample />
		</div>
	)
}

function DialogExample() {
	const [open, setOpen] = useState(false)

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>Open Dialog</Button>
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
				<Button>Open Alert Dialog</Button>
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
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={() => toast('Continue!')}>Continue</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}

function DrawerExample() {
	return (
		<Drawer>
			<DrawerTrigger asChild>
				<Button>Open Immersive Dialog</Button>
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
				<Button>Open Immersive Dialog</Button>
			</ImmersiveDialogTrigger>
			<ImmersiveDialogContent>Hello</ImmersiveDialogContent>
		</ImmersiveDialog>
	)
}
