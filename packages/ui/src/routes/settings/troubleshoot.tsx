import {matchSorter} from 'match-sorter'
import {useEffect, useRef, useState} from 'react'

import {ChevronDown} from '@/assets/chevron-down'
import {AppIcon} from '@/components/app-icon'
import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogFooter,
	immersiveDialogTitleClass,
} from '@/components/ui/immersive-dialog'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {LOADING_DASH} from '@/constants'
import {useApps} from '@/providers/apps'
import {Button} from '@/shadcn-components/ui/button'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {Input} from '@/shadcn-components/ui/input'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {cn} from '@/shadcn-lib/utils'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export default function TroubleshootDialog() {
	const title = t('troubleshoot')
	const dialogProps = useDialogOpenProps('troubleshoot')

	const tabs = [
		{id: 'umbrel', label: t('troubleshoot.umbrel-logs')},
		{id: 'dmesg', label: t('troubleshoot.dmesg-logs')},
	]
	const [activeTab, setActiveTab] = useState(tabs[0].id)

	const activeLabel = tabs.find((tab) => tab.id === activeTab)?.label

	const [appId, setAppId] = useState<string>()

	return (
		<ImmersiveDialog {...dialogProps}>
			<ImmersiveDialogContent>
				<div className='flex max-h-full flex-1 flex-col items-start gap-4'>
					<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
					<h1 className={cn(immersiveDialogTitleClass, '-mt-1 text-19')}>{title}</h1>
					<div className='flex w-full justify-between'>
						<SegmentedControl size='lg' tabs={tabs} value={activeTab} onValueChange={setActiveTab} />
						<TroubleshootDropdown appId={appId} setAppId={setAppId} />
					</div>
					<div className='flex-1 overflow-y-auto rounded-10 bg-black px-5 py-4 font-mono text-white/50'>
						{'Lorem ipsum dolor sit amet consectetur adipisicing elit. Ad, dolorum possimus! Delectus totam pariatur sint libero alias? Qui vitae voluptatum hic quam veniam quod cum provident autem praesentium, sint repellendus?'.repeat(
							6,
						)}
					</div>
					<ImmersiveDialogFooter>
						<Button variant='primary' size='dialog'>
							{t('troubleshoot.download', {label: activeLabel})}
						</Button>
						<Button size='dialog'>{t('troubleshoot.share-with-umbrel-support')}</Button>
					</ImmersiveDialogFooter>
				</div>
			</ImmersiveDialogContent>
		</ImmersiveDialog>
	)
}

function TroubleshootDropdown({appId, setAppId}: {appId?: string; setAppId: (id: string) => void}) {
	const [query, setQuery] = useState('')
	const apps = useApps()
	const [open, setOpen] = useState(false)
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
			<Button disabled>
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
				name: 'Select app...',
		  }

	const appResults = matchSorter(apps.userApps, query, {
		keys: ['name'],
		threshold: matchSorter.rankings.WORD_STARTS_WITH,
	})

	return (
		// TODO: convert to combobox: https://ui.shadcn.com/docs/components/combobox
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<Button className='min-w-36 px-3'>
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
							setAppId(appResults[0].id)
							setQuery('')
							setOpen(false)
						}
						if (e.key === 'Escape') {
							setQuery('')
							setOpen(false)
						}
					}}
					sizeVariant={'short-square'}
					placeholder='Search...'
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
								<AppIcon size={20} src={app.icon} className='rounded-4 bg-white/10' />
								{app.name}
							</DropdownMenuCheckboxItem>
						))}
					</ScrollArea>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
