import {Globe, User} from 'lucide-react'
import {useId, useState} from 'react'
import {RiAlarmWarningFill} from 'react-icons/ri'
import {
	TbAlertOctagonFilled,
	TbAlertTriangleFilled,
	TbCircle,
	TbCircleCheckFilled,
	TbInfoCircleFilled,
	TbSettings,
} from 'react-icons/tb'
import {objectKeys} from 'ts-extras'

import {ChevronDown} from '@/assets/chevron-down'
import {TorIcon} from '@/assets/tor-icon'
import {TorIcon2} from '@/assets/tor-icon2'
import {InstallButton} from '@/components/install-button'
import {Alert, ErrorAlert} from '@/components/ui/alert'
import {sizeMap} from '@/components/ui/icon'
import {IconButton} from '@/components/ui/icon-button'
import {Loading} from '@/components/ui/loading'
import {NumberedList, NumberedListItem} from '@/components/ui/numbered-list'
import {toast} from '@/components/ui/toast'
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
import {Checkbox, checkboxContainerClass, checkboxLabelClass} from '@/shadcn-components/ui/checkbox'
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
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from '@/shadcn-components/ui/drawer'
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
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {Switch} from '@/shadcn-components/ui/switch'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/shadcn-components/ui/tooltip'
import {fixmeHandler} from '@/utils/misc'
import {trackAppOpen} from '@/utils/track-app-open'
import {tw} from '@/utils/tw'

export default function Stories() {
	useUmbrelTitle('Stories Home')

	return (
		<div className='flex flex-col gap-4 bg-white/20 p-4'>
			<H1>Stories</H1>
			<H2>Buttons</H2>
			<Buttons />
			<H2>Icons</H2>
			<p>
				Make sure these have the same size and same stroke width. Settings icons is from the Tabler Icons. The Tor icon
				is custom.
			</p>
			<div className='flex items-center gap-2'>
				<TbCircle className='h-10 w-10 bg-white/10 text-brand [&>*]:stroke-1' />
				<TorIcon2 className='h-10 w-10 bg-white/10 text-brand [&>*]:stroke-1' />
				<TorIcon className='h-10 w-10 bg-white/10 text-brand [&>*]:stroke-1' />
			</div>
			<H2>Lists</H2>
			<NumberedList>
				<NumberedListItem>
					Lorem ipsum dolor sit amet consectetur adipisicing elit. Tempora tempore illum labore explicabo perspiciatis
					debitis?
				</NumberedListItem>
				<NumberedListItem>
					Porro illo placeat quos eveniet accusamus maxime. Ipsam temporibus itaque ea, iusto voluptas dicta nihil.
				</NumberedListItem>
			</NumberedList>
			<H2>Badge</H2>
			<Badges />
			<H2>Checkbox</H2>
			<CheckboxExamples />
			<H2>Alert Dialog</H2>
			<AlertDialogExample />
			<H2>Drawer</H2>
			<DrawerExample />
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
			<H2>Alert</H2>
			<AlertExample />
			<H2>Toast</H2>
			<ToastExample />
			<H2>Scroll Area</H2>
			<ScrollArea className='h-[200px] w-[350px] rounded-4 bg-white/4'>
				<div className='p-3'>
					Jokester began sneaking into the castle in the middle of the night and leaving jokes all over the place: under
					the king's pillow, in his soup, even in the royal toilet. The king was furious, but he couldn't seem to stop
					Jokester. And then, one day, the people of the kingdom discovered that the jokes left by Jokester were so
					funny that they couldn't help but laugh. And once they started laughing, they couldn't stop.
				</div>
			</ScrollArea>
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
					<DrawerClose>
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
		<>
			<div className='space-x-1'>
				<Badge variant='default'>Default</Badge>
				<Badge variant='primary'>Primary</Badge>
				<Badge variant='outline'>Outline</Badge>
				<Badge variant='destructive'>Destructive</Badge>
			</div>
			<div className='space-x-1'>
				<Badge icon={TbSettings} variant='default'>
					Default
				</Badge>
				<Badge icon={TbSettings} variant='primary'>
					Primary
				</Badge>
				<Badge icon={TbSettings} variant='outline'>
					Outline
				</Badge>
				<Badge icon={TbSettings} variant='destructive'>
					Destructive
				</Badge>
			</div>
		</>
	)
}

function CheckboxExamples() {
	const id = useId()

	return (
		<>
			<Checkbox />
			<div className={checkboxContainerClass}>
				<Checkbox defaultChecked id={id} />
				<label htmlFor={id} className={checkboxLabelClass}>
					Accept terms and conditions
				</label>
			</div>
			<Checkbox checked='indeterminate' />
		</>
	)
}

function AlertExample() {
	return (
		<div className='flex flex-col items-start gap-2'>
			<Alert variant='default' icon={TbInfoCircleFilled}>
				Informational alert that’s helpful & friendly
			</Alert>
			<Alert variant='warning' icon={TbAlertTriangleFilled}>
				Warning message but we’ll let it slide
			</Alert>
			<Alert variant='destructive' icon={TbAlertOctagonFilled}>
				Error message usually for red flags
			</Alert>
			<Alert variant='success' icon={TbCircleCheckFilled}>
				Success message for all smiles
			</Alert>
			<ErrorAlert
				icon={RiAlarmWarningFill}
				description='If you lose your password, you won’t be able to log in to your Umbrel for eternity.'
			/>
		</div>
	)
}

function ToastExample() {
	return (
		<div>
			{/* <Toaster /> should be in main or some layout file */}
			<Button onClick={() => toast('My first toast')}>Give me a toast</Button>
			<Button onClick={() => toast.success('My first toast')}>Success</Button>
			<Button onClick={() => toast.info('My first toast')}>Give me an info toast</Button>
			<Button onClick={() => toast.warning('My first toast')}>Warning</Button>
			<Button onClick={() => toast.error('My first toast')}>Error</Button>
			<Button onClick={() => toast.custom(() => <div className='bg-red-400'>Hello</div>)}>Custom</Button>
			<Button
				onClick={() =>
					toast('Event has been created', {
						description: 'Monday, January 3rd at 6:00pm',
						action: {
							label: 'Action',
							onClick: fixmeHandler,
						},
						classNames: {
							actionButton: tw`rounded-full bg-red-500`,
						},
					})
				}
			>
				Action
			</Button>
		</div>
	)
}
