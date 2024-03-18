import {ReactNode} from 'react'
import {useLocation, useNavigate} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {Card} from '@/components/ui/card'
import {ImmersiveDialog, ImmersiveDialogContent, immersiveDialogTitleClass} from '@/components/ui/immersive-dialog'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {LOADING_DASH} from '@/constants'
import {useCpuForUi} from '@/hooks/use-cpu'
import {useDiskForUi} from '@/hooks/use-disk'
import {useIsSmallMobile} from '@/hooks/use-is-mobile'
import {useMemoryForUi} from '@/hooks/use-memory'
import {systemAppsKeyed, useApps} from '@/providers/apps'
import {Progress} from '@/shadcn-components/ui/progress'
import {cn} from '@/shadcn-lib/utils'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'
import {formatNumberI18n} from '@/utils/number'
import {maybePrettyBytes} from '@/utils/pretty-bytes'
import {tw} from '@/utils/tw'

export default function LiveUsageDialog() {
	const title = t('live-usage')
	const dialogProps = useDialogOpenProps('live-usage')

	return (
		<ImmersiveDialog {...dialogProps}>
			<ImmersiveDialogContent size='lg' showScroll>
				<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
				<h1 className={immersiveDialogTitleClass}>{title}</h1>
				<LiveUsageContent />
			</ImmersiveDialogContent>
		</ImmersiveDialog>
	)
}

type SelectedTab = 'storage' | 'memory' | 'cpu'

function LiveUsageContent() {
	const isSmall = useIsSmallMobile()
	const {search} = useLocation()
	const navigate = useNavigate()
	const queryParams = new URLSearchParams(search)
	const selectedTab = (queryParams.get('tab') as SelectedTab) || 'storage'

	const setSelectedTab = (tab: SelectedTab) => {
		queryParams.set('tab', tab)
		navigate({search: queryParams.toString()})
	}

	if (isSmall) {
		return (
			<div className='grid gap-y-5'>
				{isSmall && (
					<SegmentedControl
						size='lg'
						tabs={[
							{id: 'storage', label: t('storage')},
							{id: 'memory', label: t('memory')},
							{id: 'cpu', label: t('cpu')},
						]}
						value={selectedTab}
						onValueChange={setSelectedTab}
					/>
				)}
				{selectedTab === 'storage' && <StorageSection />}
				{selectedTab === 'memory' && <MemorySection />}
				{selectedTab === 'cpu' && <CpuSection />}
			</div>
		)
	}

	return (
		<div className='grid grid-cols-3 gap-x-4'>
			<LiveUsageSection title={t('storage')}>
				<StorageSection />
			</LiveUsageSection>
			<LiveUsageSection title={t('memory')}>
				<MemorySection />
			</LiveUsageSection>
			<LiveUsageSection title={t('cpu')}>
				<CpuSection />
			</LiveUsageSection>
		</div>
	)
}

// ---

function LiveUsageSection({title, children}: {title: string; children: React.ReactNode}) {
	const isSmall = useIsSmallMobile()

	if (isSmall) return children

	return (
		<div className='flex flex-col gap-3'>
			<h2 className='text-17 font-semibold -tracking-2 text-white/80'>{title}</h2>
			{children}
		</div>
	)
}

function StorageSection() {
	const {isLoading, value, valueSub, secondaryValue, progress, isDiskLow, isDiskFull, system, downloads, apps} =
		useDiskForUi({
			poll: true,
		})

	return (
		<>
			<ProgressCard
				value={value}
				valueSub={valueSub}
				progressLabel={secondaryValue}
				progress={progress}
				rightChildren={
					<>
						{isDiskLow && <ErrorMessage>{t('storage.low')}</ErrorMessage>}
						{isDiskFull && <ErrorMessage>{t('storage.full')}</ErrorMessage>}
					</>
				}
			/>
			{isLoading && <AppListSkeleton />}
			<AppList system={system} downloads={downloads} apps={apps} formatValue={(v) => maybePrettyBytes(v)} />
		</>
	)
}

function MemorySection() {
	const {isLoading, value, valueSub, secondaryValue, progress, isMemoryLow, system, apps} = useMemoryForUi({poll: true})

	return (
		<>
			<ProgressCard
				value={value}
				valueSub={valueSub}
				progressLabel={secondaryValue}
				progress={progress}
				rightChildren={isMemoryLow && <ErrorMessage>{t('memory.low')}</ErrorMessage>}
			/>
			{isLoading && <AppListSkeleton />}
			<AppList system={system} apps={apps} formatValue={(v) => maybePrettyBytes(v)} />
		</>
	)
}

function CpuSection() {
	const {isLoading, value, secondaryValue, progress, system, apps} = useCpuForUi({poll: true})

	return (
		<>
			<ProgressCard value={value} progressLabel={secondaryValue} progress={progress} />
			{isLoading && <AppListSkeleton />}
			<AppList system={system} apps={apps} formatValue={(v) => formatNumberI18n(v) + '%'} />
		</>
	)
}

function ProgressCard({
	value,
	valueSub,
	progressLabel,
	progress = 0,
	rightChildren,
}: {
	value?: string
	valueSub?: string
	progressLabel?: string
	progress?: number
	rightChildren?: ReactNode
}) {
	return (
		<Card className='flex flex-col gap-4'>
			<div className='flex items-center justify-between gap-2'>
				<div className='flex min-w-0 items-end gap-1 text-24 font-semibold leading-none -tracking-3 opacity-80'>
					<span className='min-w-0 truncate'>{value ?? LOADING_DASH}</span>
					<span className='min-w-0 flex-1 truncate text-13 font-bold opacity-[45%]'>{valueSub}</span>
				</div>
				{rightChildren}
			</div>
			<div className='flex flex-col gap-2'>
				<div className='text-13 font-semibold -tracking-2 opacity-40'>{progressLabel}</div>
				<Progress value={progress * 100} variant='primary' />
			</div>
		</Card>
	)
}

function ErrorMessage({children}: {children?: ReactNode}) {
	return (
		<div className='flex items-center gap-2 text-[#F45A5A]'>
			<div className='h-[5px] w-[5px] animate-pulse rounded-full bg-current ring-3 ring-[#F45A5A]/20'></div>
			<div className={cn('text-13 font-medium -tracking-2', 'leading-inter-trimmed')}>{children}</div>
		</div>
	)
}

// --

function AppList({
	system,
	downloads,
	apps,
	formatValue,
}: {
	system?: number
	downloads?: number
	apps?: {id: string; used: number}[]
	formatValue: (value: number) => string
}) {
	const {userAppsKeyed} = useApps()

	if (userAppsKeyed === undefined) return null
	if (!apps || apps.length === 0) return null

	return (
		<div className={appListClass}>
			<AppListRow
				icon={systemAppsKeyed.UMBREL_system.icon}
				title={systemAppsKeyed.UMBREL_system.name}
				value={system === undefined ? LOADING_DASH : formatValue(system)}
			/>
			{downloads !== undefined && (
				<AppListRow
					icon={systemAppsKeyed.UMBREL_downloads.icon}
					title={systemAppsKeyed.UMBREL_downloads.name}
					value={downloads === undefined ? LOADING_DASH : formatValue(downloads)}
				/>
			)}
			{apps?.map(({id, used}) => (
				<AppListRow
					key={id}
					icon={userAppsKeyed[id]?.icon}
					title={userAppsKeyed[id]?.name || t('unknown-app')}
					value={formatValue(used)}
				/>
			))}
		</div>
	)
}

export function AppListSkeleton() {
	return (
		<div className={appListClass}>
			{/* TODO: derive app count and use that here */}
			<AppListRow title={LOADING_DASH} value={LOADING_DASH} />
		</div>
	)
}

const appListClass = tw`divide-y divide-white/6 rounded-12 bg-white/5`

function AppListRow({icon, title, value, disabled}: {icon?: string; title: string; value: string; disabled?: boolean}) {
	return (
		<div className={cn('flex items-center gap-2 p-3', disabled && 'opacity-50')}>
			<AppIcon src={icon} size={25} className={cn('rounded-5 shadow-md', disabled && 'grayscale')} />
			<span className='flex-1 truncate text-15 font-medium -tracking-4 opacity-90'>{title}</span>
			<span className='text-15 font-normal uppercase tabular-nums -tracking-3'>{value}</span>
		</div>
	)
}
