import {matchSorter} from 'match-sorter'
import {useEffect, useRef, useState} from 'react'
import {TbChevronLeft} from 'react-icons/tb'
import {Link} from 'react-router-dom'

import {ChevronDown} from '@/assets/chevron-down'
import {AppIcon} from '@/components/app-icon'
import {ImmersiveDialogContent, immersiveDialogTitleClass} from '@/components/ui/immersive-dialog'
import {LOADING_DASH} from '@/constants'
import {useApps} from '@/providers/apps'
import {Button} from '@/shadcn-components/ui/button'
import {DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger} from '@/shadcn-components/ui/dropdown-menu'
import {Input} from '@/shadcn-components/ui/input'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

export const radioButtonClass = tw`rounded-12 bg-white/5 p-5 text-left flex justify-between items-center gap-2 flex-wrap shadow-button-highlight-soft-hpx outline-none duration-300 hover:bg-white/6 transition-[background,color,box-shadow] focus-visible:ring-4 ring-white/5 focus-visible:ring-offset-1 ring-offset-white/20`
export const radioTitleClass = tw`text-15 font-medium -tracking-2`
export const radioDescriptionClass = tw`text-13 opacity-90 -tracking-2`

export const immersivePickerDialogTitleClass = cn(immersiveDialogTitleClass, '-mt-1 text-19')

export function ImmersivePickerDialogContentInit({title, children}: {title: string; children: React.ReactNode}) {
	return (
		<ImmersiveDialogContent short>
			<h1 className={immersivePickerDialogTitleClass}>{title}</h1>
			<div className='flex flex-col gap-2.5'>{children}</div>
		</ImmersiveDialogContent>
	)
}

export function ImmersivePickerItem({
	title,
	description,
	children,
	to,
	onClick,
}: {
	title: string
	description: string
	to?: string
	children?: React.ReactNode
	onClick?: () => void
}) {
	if (to) {
		return (
			<Link to={to} className={radioButtonClass}>
				<div>
					<div className={radioTitleClass}>{title}</div>
					<div className={radioDescriptionClass}>{description}</div>
				</div>
				{children}
			</Link>
		)
	}
	return (
		<div className={cn(radioButtonClass, 'cursor-pointer')} onClick={onClick}>
			<div>
				<div className={radioTitleClass}>{title}</div>
				<div className={radioDescriptionClass}>{description}</div>
			</div>
			{children}
		</div>
	)
}

export function BackLink({to, children}: {to: string; children: React.ReactNode}) {
	return (
		<Link
			to={to}
			className='flex items-center justify-center rounded-full pr-2 decoration-white/20 underline-offset-4 outline-none focus-visible:underline'
		>
			<TbChevronLeft className='size-6 opacity-50' />
			<h1 className={cn(immersiveDialogTitleClass, 'text-19')}>{children}</h1>
		</Link>
	)
}

export function ImmersivePickerDialogContent({children}: {children: React.ReactNode}) {
	return (
		<ImmersiveDialogContent size='xl'>
			<div className='flex max-h-full flex-1 flex-col items-start gap-4'>{children}</div>
		</ImmersiveDialogContent>
	)
}

export function AppDropdown({
	appId,
	setAppId,
	open,
	onOpenChange,
}: {
	appId?: string
	setAppId: (id: string) => void
	open: boolean
	onOpenChange: (o: boolean) => void
}) {
	const [query, setQuery] = useState('')
	const apps = useApps()
	// const [open, setOpen] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (!open) return
		setTimeout(() => {
			inputRef.current?.focus()
			inputRef.current?.select()
		}, 0)
	}, [open])

	if (apps.isLoading || !apps.userApps || !apps.userAppsKeyed) {
		return (
			<Button className='h-[36px] min-w-36 px-3'>
				<AppIcon size={20} className='rounded-4' />
				{LOADING_DASH}
				<ChevronDown />
			</Button>
		)
	}

	const selectedApp = appId
		? apps.userAppsKeyed[appId]
		: {
				icon: undefined,
				name: t('app-picker.select-app'),
			}

	const appResults = matchSorter(apps.userApps, query, {
		keys: ['name'],
		threshold: matchSorter.rankings.WORD_STARTS_WITH,
	})

	return (
		// TODO: convert to combobox: https://ui.shadcn.com/docs/components/combobox
		<>
			<DropdownMenuTrigger asChild>
				<Button className='h-[36px] min-w-36 px-3'>
					<span className='flex flex-1 flex-row items-center gap-2'>
						{selectedApp.icon && <AppIcon size={20} src={selectedApp.icon} className='rounded-4' />}
						{selectedApp.name}
					</span>
					<ChevronDown />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className='flex max-h-72 min-w-64 flex-col gap-3' align='start'>
				<Input
					value={query}
					className='shrink-0'
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						// Prevent key presses from triggering stuff in the dropdown menu
						e.stopPropagation()
						if (e.key === 'Enter') {
							e.preventDefault()
							setAppId(appResults[0].id)
							setQuery('')
							onOpenChange(false)
						}
						if (e.key === 'Escape') {
							setQuery('')
							onOpenChange(false)
						}
					}}
					sizeVariant={'short-square'}
					placeholder={t('app-picker.search')}
					ref={inputRef}
				/>
				{appResults.length === 0 && <div className='text-14 text-white/50'>{t('no-results-found')}</div>}
				{appResults.length > 0 && (
					<ScrollArea className='relative -mx-2.5 flex h-full flex-col px-2.5'>
						{appResults.map((app, i) => (
							<DropdownMenuCheckboxItem
								key={app.id}
								checked={app.id === appId}
								onSelect={() => setAppId(app.id)}
								className='flex gap-2'
								data-highlighted={i === 0 && query ? true : undefined}
							>
								<AppIcon size={20} src={app.icon} className='rounded-4' />
								{app.name}
							</DropdownMenuCheckboxItem>
						))}
					</ScrollArea>
				)}
			</DropdownMenuContent>
		</>
	)
}
