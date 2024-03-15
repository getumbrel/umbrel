import {ReactNode} from 'react'

import {AppIcon} from '@/components/app-icon'
import {Card} from '@/components/ui/card'
import {ImmersiveDialog, ImmersiveDialogContent, immersiveDialogTitleClass} from '@/components/ui/immersive-dialog'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {LOADING_DASH} from '@/constants'
import {useCpuForUi} from '@/hooks/use-cpu'
import {useDiskForUi} from '@/hooks/use-disk'
import {useIsSmallMobile} from '@/hooks/use-is-mobile'
import {useLocalStorage2} from '@/hooks/use-local-storage2'
import {useMemoryForUi} from '@/hooks/use-memory'
import {useApps} from '@/providers/apps'
import {Progress} from '@/shadcn-components/ui/progress'
import {cn} from '@/shadcn-lib/utils'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'
import {maybePrettyBytes} from '@/utils/pretty-bytes'
import {tw} from '@/utils/tw'

export default function LiveUsageDialog() {
	const title = t('live-usage')
	const dialogProps = useDialogOpenProps('live-usage')

	return (
		<ImmersiveDialog {...dialogProps}>
			<ImmersiveDialogContent size='lg'>
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
	const {allAppsKeyed} = useApps()
	const [selectedTab, setSelectedTab] = useLocalStorage2<SelectedTab>('live-usage-selected-tab', 'storage')

	if (!allAppsKeyed) return null
	if (!selectedTab) return null

	if (isSmall) {
		return (
			<div className='grid gap-y-5'>
				{isSmall && (
					<SegmentedControl
						size='lg'
						// variant={variant}
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
	const {isLoading, value, valueSub, secondaryValue, progress, isDiskLow, isDiskFull, apps} = useDiskForUi({poll: true})

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
			<AppList apps={apps} />
		</>
	)
}

function MemorySection() {
	const {isLoading, value, valueSub, secondaryValue, progress, isMemoryLow, apps} = useMemoryForUi({poll: true})

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
			<AppList apps={apps} />
		</>
	)
}

function CpuSection() {
	const {isLoading, value, secondaryValue, progress, apps} = useCpuForUi({poll: true})

	return (
		<>
			<ProgressCard value={value} progressLabel={secondaryValue} progress={progress} />
			{isLoading && <AppListSkeleton />}
			<AppList2 apps={apps} />
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

function AppList({apps}: {apps?: {id: string; used: number}[]}) {
	const {allAppsKeyed} = useApps()

	if (!apps || apps.length === 0) return null

	return (
		<div className={appListClass}>
			{apps?.map(({id, used}) => (
				<AppListRow
					key={id}
					icon={allAppsKeyed[id]?.icon}
					title={allAppsKeyed[id]?.name || t('unknown-app')}
					value={maybePrettyBytes(used)}
				/>
			))}
		</div>
	)
}

function AppList2({apps}: {apps?: {id: string; used: number}[]}) {
	const {allAppsKeyed} = useApps()

	if (!apps || apps.length === 0) return null

	return (
		<div className={appListClass}>
			{apps?.map(({id, used}) => (
				<AppListRow
					key={id}
					icon={allAppsKeyed[id]?.icon}
					title={allAppsKeyed[id]?.name || t('unknown-app')}
					value={used.toFixed(2) + '%'}
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

function AppListRow({icon, title, value}: {icon?: string; title: string; value: string}) {
	return (
		<div className='flex items-center gap-2 p-3'>
			<AppIcon src={icon} size={25} className='rounded-5 shadow-md' />
			<span className='flex-1 truncate text-15 font-medium -tracking-4 opacity-90'>{title}</span>
			<span className='text-15 font-normal uppercase tabular-nums -tracking-3'>{value}</span>
		</div>
	)
}
