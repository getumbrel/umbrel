import {H1, H2, H3} from '@stories/components'
import {Globe, User} from 'lucide-react'
import {ComponentProps, useEffect, useId, useState} from 'react'
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
import {Alert, ErrorAlert} from '@/components/ui/alert'
import {sizeMap} from '@/components/ui/icon'
import {IconButton} from '@/components/ui/icon-button'
import {listItemClass} from '@/components/ui/list'
import {Loading} from '@/components/ui/loading'
import {NumberedList, NumberedListItem} from '@/components/ui/numbered-list'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {toast} from '@/components/ui/toast'
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
import {Label} from '@/shadcn-components/ui/label'
import {RadioGroup, RadioGroupItem} from '@/shadcn-components/ui/radio-group'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {Switch} from '@/shadcn-components/ui/switch'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/shadcn-components/ui/tooltip'
import {t} from '@/utils/i18n'
import {fixmeHandler} from '@/utils/misc'

export default function Stories() {
	return (
		<div className='flex flex-col gap-4 bg-white/20 p-4'>
			<H1>Stories</H1>
			<H2>i18n</H2>
			<I18Examples />
			<H2>Buttons</H2>
			<Buttons />
			<H2>Segmented Control</H2>
			<SegmentedControlExamples />
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
			<H2>Radio Group</H2>
			<RadioGroupDemo />
			<H2>Checkbox</H2>
			<CheckboxExamples />
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
			<H2>Prevent double toast</H2>
			<PreventDoubleToast />
			<H2>Scroll Area</H2>
			<ScrollArea className='h-[200px] w-[350px] rounded-4 bg-white/4'>
				<div className='p-3'>
					Jokester began sneaking into the castle in the middle of the night and leaving jokes all over the place: under
					the king's pillow, in his soup, even in the royal toilet. The king was furious, but he couldn't seem to stop
					Jokester. And then, one day, the people of the kingdom discovered that the jokes left by Jokester were so
					funny that they couldn't help but laugh. And once they started laughing, they couldn't stop.
				</div>
			</ScrollArea>
			<ScrollArea className='h-[200px] w-[350px] rounded-12 bg-white/6' scrollbarClass='my-3'>
				<div className='divide-y divide-white/6 '>
					{Array.from({length: 20}).map((_, i) => (
						<div key={i} className={listItemClass}>
							hello {i}
						</div>
					))}
				</div>
			</ScrollArea>
		</div>
	)
}

export function RadioGroupDemo() {
	return (
		<RadioGroup defaultValue='comfortable'>
			<div className='flex items-center space-x-2'>
				<RadioGroupItem value='default' id='r1' />
				<Label htmlFor='r1'>Default</Label>
			</div>
			<div className='flex items-center space-x-2'>
				<RadioGroupItem value='comfortable' id='r2' />
				<Label htmlFor='r2'>Comfortable</Label>
			</div>
			<div className='flex items-center space-x-2'>
				<RadioGroupItem value='compact' id='r3' />
				<Label htmlFor='r3'>Compact</Label>
			</div>
			<div className='flex items-center space-x-2'>
				<RadioGroupItem value='disabled' id='r4' disabled />
				<Label htmlFor='r4'>Disabled</Label>
			</div>
		</RadioGroup>
	)
}

export function I18Examples() {
	return (
		<div>
			<H3>Trans component</H3>
			<H3>Plurals</H3>
			<p>{0 + ' installed ' + t('app', {count: 0})}</p>
			<p>{1 + ' installed ' + t('app', {count: 1})}</p>
			<p>{5 + ' installed ' + t('app', {count: 5})}</p>
			<p>{t('factory-reset.review.installed-apps', {count: 0})}</p>
			<p>{t('factory-reset.review.installed-apps', {count: 1})}</p>
			<p>{t('factory-reset.review.installed-apps', {count: 2})}</p>
		</div>
	)
}

function PreventDoubleToast() {
	const [count, setCount] = useState(0)
	const [mounted, setMounted] = useState(false)

	useEffect(() => {
		if (!mounted) return
		const id = toast.info('count: ' + count)

		return () => {
			toast.dismiss(id)
		}
	}, [count, mounted])

	useEffect(() => {
		if (!mounted) setMounted(true)
	}, [mounted])

	return (
		<div>
			<p>By default running toast from useEffect in strict mode causes 2 toasts to render. See code.</p>
			<Button size='xl' onClick={() => setCount((c) => c - 1)}>
				-1
			</Button>
			<Button size='xl' onClick={() => setCount((c) => c + 1)}>
				+1
			</Button>
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

function SegmentedControlExamples() {
	const sizes: ComponentProps<typeof SegmentedControl>['size'][] = ['sm', 'default', 'lg']
	const variants: ComponentProps<typeof SegmentedControl>['variant'][] = ['default', 'primary']

	const [selectedTab, setSelectedTab] = useState('change-name')
	const [selectedTab2, setSelectedTab2] = useState('one')
	const [selectedTab3, setSelectedTab3] = useState<string>()

	return (
		<div className='flex flex-wrap justify-start gap-2'>
			{sizes.map((size) => (
				<div key={size} className='flex flex-col gap-2'>
					{variants.map((variant) => (
						<SegmentedControl
							key={`${size}-${variant}`}
							size={size}
							variant={variant}
							tabs={[
								{id: 'change-name', label: 'Display name'},
								{id: 'change-password', label: 'Password'},
							]}
							value={selectedTab}
							onValueChange={setSelectedTab}
						/>
					))}
				</div>
			))}
			{sizes.map((size) => (
				<div key={size} className='flex flex-col gap-2'>
					{variants.map((variant) => (
						<SegmentedControl
							key={`${size}-${variant}`}
							size={size}
							variant={variant}
							tabs={[
								{id: 'one', label: 'One'},
								{id: 'two', label: 'Two'},
								{id: 'three', label: 'Three'},
							]}
							value={selectedTab2}
							onValueChange={setSelectedTab2}
						/>
					))}
				</div>
			))}
			{sizes.map((size) => (
				<div key={size} className='flex flex-col gap-2'>
					{variants.map((variant) => (
						<SegmentedControl
							key={`${size}-${variant}`}
							size={size}
							variant={variant}
							tabs={[
								{id: 'change-name', label: 'Display name'},
								{id: 'change-password', label: 'Password'},
							]}
							value={selectedTab3}
							onValueChange={setSelectedTab3}
						/>
					))}
				</div>
			))}
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
			<Button
				onClick={() =>
					toast('My persisting toast', {
						duration: Infinity,
					})
				}
			>
				Give me a persisting toast
			</Button>
			<Button onClick={() => toast.success('My first toast', {duration: Infinity})}>Success</Button>
			<Button onClick={() => toast.info('My first toast')}>Give me an info toast</Button>
			<Button onClick={() => toast.warning('My first toast')}>Warning</Button>
			<Button onClick={() => toast.error('My first toast')}>Error</Button>
			<Button onClick={() => toast.custom(() => <div className='bg-red-400'>Hello</div>)}>Custom</Button>
			<Button
				onClick={() =>
					toast('Event has been created', {
						description: 'Monday, January 3rd at 6:00pm',
						action: {
							label: 'OK',
							onClick: fixmeHandler,
						},
						duration: Infinity,
					})
				}
			>
				Action
			</Button>
		</div>
	)
}
