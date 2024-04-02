import {format} from 'date-fns'
import {saveAs} from 'file-saver'
import filenamify from 'filenamify/browser'
import {matchSorter} from 'match-sorter'
import {useEffect, useRef, useState} from 'react'
import {TbChevronLeft} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {ChevronDown} from '@/assets/chevron-down'
import {AppIcon} from '@/components/app-icon'
import {immersiveDialogTitleClass} from '@/components/ui/immersive-dialog'
import {LOADING_DASH} from '@/constants'
import {useApps} from '@/providers/apps'
import {Button} from '@/shadcn-components/ui/button'
import {DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger} from '@/shadcn-components/ui/dropdown-menu'
import {Input} from '@/shadcn-components/ui/input'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {cn} from '@/shadcn-lib/utils'
import {RouterInput} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export type SystemLogType = RouterInput['system']['logs']['type']

export function TroubleshootTitleBackButton() {
	const title = t('troubleshoot')
	const navigate = useNavigate()

	return (
		<button
			onClick={() => navigate('/settings/troubleshoot')}
			className='flex items-center justify-center rounded-full pr-2 decoration-white/20 underline-offset-4 outline-none focus-visible:underline'
		>
			<TbChevronLeft className='size-6 opacity-50' />
			<h1 className={cn(immersiveDialogTitleClass, 'text-19')}>{title}</h1>
		</button>
	)
}

export const downloadUtf8Logs = (contents: string, fileNameString?: string) => {
	const blob = new Blob([contents], {type: 'text/plain;charset=utf-8'})

	// Separating sections with `_` so easier to machine-parse in the future
	const name = ['umbrel', filenamify(fileNameString ?? 'logs'), format(new Date(), 'yyyy-MM-dd_HH-mm')].join('_')

	// Final pass: replacing strings and doing lowercase so good for urls too?
	const finalName = name.replace(/\s+/g, '-').toLocaleLowerCase()

	saveAs(blob, finalName + '.log')
}

export function useScrollToBottom(ref: React.RefObject<HTMLDivElement>, deps: any[]) {
	useEffect(() => {
		setTimeout(() => {
			if (!ref.current) return
			ref.current.scrollTop = ref.current.scrollHeight + 100
		}, 300)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ref, ...deps])
}

export function LogResults({children}: {children: string}) {
	const ref = useRef<HTMLDivElement>(null)
	useScrollToBottom(ref, [children])

	return (
		<div ref={ref} className='w-full flex-1 overflow-auto rounded-10 bg-black px-5 py-4'>
			<div
				key={children}
				className={cn(
					'whitespace-pre font-mono text-xs text-white/50',
					children && 'delay-500 animate-in fade-in fill-mode-both',
				)}
			>
				{children}
			</div>
			{/* Keeps scroll pinned to bottom */}
			<div style={{overflowAnchor: 'auto'}} />
		</div>
	)
}

export function TroubleshootDropdown({
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
				name: t('troubleshoot.select-app'),
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
					placeholder={t('troubleshoot.search')}
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
