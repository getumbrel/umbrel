import {Globe, User} from 'lucide-react'
import {useState} from 'react'
import {toast} from 'sonner'
import {objectKeys} from 'ts-extras'

import {ChevronDown} from '@/assets/chevron-down'
import {InstallButton} from '@/components/install-button'
import {sizeMap} from '@/components/ui/icon'
import {IconButton} from '@/components/ui/icon-button'
import {Loading} from '@/components/ui/loading'
import {useDemoInstallProgress} from '@/hooks/use-demo-progress'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {H1, H2, H3} from '@/layouts/stories'
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
import {Badge} from '@/shadcn-components/ui/badge'
import {Button} from '@/shadcn-components/ui/button'
import {
	ContextMenu,
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuRadioGroup,
	ContextMenuRadioItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from '@/shadcn-components/ui/context-menu'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {Switch} from '@/shadcn-components/ui/switch'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/shadcn-components/ui/tooltip'
import {trackAppOpen} from '@/utils/track-app-open'

export default function Stories() {
	useUmbrelTitle('Stories Home')

	return (
		<div className='flex flex-col gap-4 bg-white/20 p-4'>
			<H1>Stories</H1>
			<H2>Buttons</H2>
			<Buttons />
			<H2>Badge</H2>
			<Badges />
			<H2>Alert Dialog</H2>
			<AlertDialogExample />
			<H2>Loading</H2>
			<Loading />
			<H2>Tooltip</H2>
			<TooltipExample />
			<H2>Switch</H2>
			<Switch />
			<H2>Dropdown</H2>
			<DropdownExample />
			<H2>Context Menu</H2>
			<ContextMenuExample />
			<H2>Toast</H2>
			<ToastExample />
		</div>
	)
}

function TooltipExample() {
	return (
		<Tooltip>
			<TooltipTrigger>Hover</TooltipTrigger>
			<TooltipContent>
				<p>Add to library</p>
			</TooltipContent>
		</Tooltip>
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
						<AlertDialogAction>Continue</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			{/* <div className="fixed bottom-0 left-0 z-[99]">
        <button className="cursor-pointer" onClick={() => alert("hello")}>
          Click
        </button>
      </div> */}
		</div>
	)
}

function DropdownExample() {
	const [position, setPosition] = useState('bottom')

	return (
		<div className='flex gap-2'>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<IconButton icon={Globe}>
						English
						<ChevronDown />
					</IconButton>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuCheckboxItem checked>English</DropdownMenuCheckboxItem>
					<DropdownMenuCheckboxItem>French</DropdownMenuCheckboxItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{/*  */}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<IconButton icon={User}>
						Account
						<ChevronDown />
					</IconButton>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuLabel>My Account</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem>Profile</DropdownMenuItem>
					<DropdownMenuItem>Billing</DropdownMenuItem>
					<DropdownMenuItem>Team</DropdownMenuItem>
					<DropdownMenuItem>Subscription</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{/*  */}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<IconButton icon={User}>
						Account
						<ChevronDown />
					</IconButton>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuRadioGroup value={position} onValueChange={setPosition}>
						<DropdownMenuRadioItem value='top'>Top</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value='bottom'>Bottom</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value='right'>Right</DropdownMenuRadioItem>
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}

function ContextMenuExample() {
	const [position, setPosition] = useState('bottom')

	return (
		<div className='grid place-items-center bg-white/5 p-4'>
			<ContextMenu modal={false}>
				<ContextMenuTrigger asChild>
					<div className='grid h-36 w-full max-w-sm select-none place-items-center border border-dashed'>
						Right click
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem>Edit Widgets</ContextMenuItem>
					<ContextMenuItem>Change wallpaper</ContextMenuItem>
					<ContextMenuCheckboxItem checked>Show desktop icons</ContextMenuCheckboxItem>
					<ContextMenuSeparator />
					<ContextMenuRadioGroup value={position} onValueChange={setPosition}>
						<ContextMenuRadioItem value='top'>Top</ContextMenuRadioItem>
						<ContextMenuRadioItem value='bottom'>Bottom</ContextMenuRadioItem>
						<ContextMenuRadioItem value='right'>Right</ContextMenuRadioItem>
					</ContextMenuRadioGroup>
				</ContextMenuContent>
			</ContextMenu>
		</div>
	)
}

function Buttons() {
	return (
		<div className='flex flex-col gap-2'>
			<ProgressButton />
			<div>
				<H3>Sizes</H3>
				<div className='flex gap-2'>
					{objectKeys(sizeMap).map((size) => (
						<div key={size} className='flex flex-col gap-2'>
							<div>{size}</div>
							<Button size={size}>Settings</Button>
							<Button variant='primary' size={size}>
								Settings
							</Button>
							<Button variant='secondary' size={size}>
								Settings
							</Button>
							<Button variant='destructive' size={size}>
								Settings
							</Button>
						</div>
					))}
				</div>
				<div className='flex gap-2'>
					{objectKeys(sizeMap).map((size) => (
						<div key={size} className='flex flex-col gap-2'>
							<div>{size}</div>
							<IconButton size={size} icon={Globe}>
								Settings
							</IconButton>
							<IconButton variant='primary' size={size} icon={Globe}>
								Settings
							</IconButton>
							<IconButton variant='secondary' size={size} icon={Globe}>
								Settings
							</IconButton>
							<IconButton variant='destructive' size={size} icon={Globe}>
								Settings
							</IconButton>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}

function ProgressButton() {
	const {progress, state, install} = useDemoInstallProgress()

	return (
		<div>
			<H3>Install Button</H3>
			<InstallButton
				installSize='1.5GB'
				progress={progress}
				state={state}
				onInstallClick={install}
				onOpenClick={() => trackAppOpen('foobar')}
			/>
		</div>
	)
}

function Badges() {
	return (
		<div className='space-x-1'>
			<Badge variant='default'>Default</Badge>
			<Badge variant='primary'>Primary</Badge>
			<Badge variant='outline'>Outline</Badge>
			<Badge variant='destructive'>Destructive</Badge>
		</div>
	)
}

function ToastExample() {
	return (
		<div>
			{/* <Toaster /> should be in main or some layout file */}
			<Button onClick={() => toast('My first toast')}>Give me a toast</Button>
			<Button onClick={() => toast.success('My first toast')}>Give me a success toast</Button>
			<Button onClick={() => toast.warning('My first toast')}>Give me a warning toast</Button>
			<Button onClick={() => toast.error('My first toast')}>Give me a error toast</Button>
		</div>
	)
}
