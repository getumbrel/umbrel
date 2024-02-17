import {useState} from 'react'

import {toast} from '@/components/ui/toast'
import {H2} from '@/layouts/stories'
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
			<H2>Dialog</H2>
			<DialogExample />
			<H2>Alert Dialog</H2>
			<AlertDialogExample />
			<H2>Drawer</H2>
			<DrawerExample />
		</>
	)
}

function DialogExample() {
	const [open, setOpen] = useState(false)

	return (
		<div>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogTrigger asChild>
					<Button variant='destructive'>Delete account</Button>
				</DialogTrigger>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Are you absolutely sure?</DialogTitle>
						<DialogDescription>
							This action cannot be undone. This will permanently delete your account and remove your data from our
							servers.
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
		</div>
	)
}

function AlertDialogExample() {
	return (
		<div>
			<AlertDialog>
				<AlertDialogTrigger asChild>
					<Button variant='destructive'>Delete account</Button>
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
						<AlertDialogDescription>
							This action cannot be undone. This will permanently delete your account and remove your data from our
							servers.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={() => toast('Continue!')}>Continue</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}

function DrawerExample() {
	return (
		<Drawer>
			<DrawerTrigger>Open</DrawerTrigger>
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
