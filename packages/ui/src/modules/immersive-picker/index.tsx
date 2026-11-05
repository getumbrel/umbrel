import {useTranslation} from 'react-i18next'
import {TbChevronLeft} from 'react-icons/tb'
import {Link, type To} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {ChevronDown} from '@/components/chevron-down'
import {Button} from '@/components/ui/button'
import {ImmersiveDialogContent, immersiveDialogTitleClass} from '@/components/ui/immersive-dialog'
import {SearchablePicker} from '@/components/ui/searchable-picker'
import {LOADING_DASH} from '@/constants'
import {cn} from '@/lib/utils'
import {useApps} from '@/providers/apps'
import {tw} from '@/utils/tw'

export const radioButtonClass = tw`rounded-12 bg-white/5 p-5 text-left flex justify-between items-center gap-2 flex-wrap shadow-button-highlight-soft-hpx outline-hidden duration-300 hover:bg-white/6 transition-[background,color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring`
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
	to?: To
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
		<div className={cn(radioButtonClass)} onClick={onClick}>
			<div>
				<div className={radioTitleClass}>{title}</div>
				<div className={radioDescriptionClass}>{description}</div>
			</div>
			{children}
		</div>
	)
}

export function BackLink({to, children}: {to: To; children: React.ReactNode}) {
	return (
		<Link
			to={to}
			className='flex items-center justify-center rounded-full pr-2 decoration-white/20 underline-offset-4 outline-hidden focus-visible:underline'
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
	open?: boolean
	onOpenChange?: (open: boolean) => void
}) {
	const {t} = useTranslation()
	const apps = useApps()
	const selectedApp = appId ? apps.userAppsKeyed?.[appId] : undefined
	return (
		<SearchablePicker
			open={open}
			onOpenChange={onOpenChange}
			align='start'
			placeholder={t('app-picker.search')}
			emptyLabel={t('app-settings-list.no-apps')}
			loading={apps.isLoading}
			value={appId}
			onSelect={setAppId}
			items={(apps.userApps ?? []).map((app) => ({
				value: app.id,
				label: app.name,
				icon: <AppIcon size={24} src={app.icon} className='shrink-0 rounded-6' />,
			}))}
		>
			<Button className='h-9 max-w-64 min-w-36 px-3'>
				<span className='flex min-w-0 flex-1 items-center gap-2'>
					{selectedApp?.icon && <AppIcon size={20} src={selectedApp.icon} className='shrink-0 rounded-4' />}
					<span className='min-w-0 truncate'>
						{apps.isLoading ? LOADING_DASH : (selectedApp?.name ?? t('app-picker.select-app'))}
					</span>
				</span>
				<ChevronDown />
			</Button>
		</SearchablePicker>
	)
}
