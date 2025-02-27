import {DialogPortal} from '@radix-ui/react-dialog'
import {motion} from 'framer-motion'
import {ReactNode, useEffect, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useLocation, useNavigate} from 'react-router-dom'
import {Area, AreaChart, ResponsiveContainer, XAxis, YAxis} from 'recharts'

import {AppIcon} from '@/components/app-icon'
import {Card} from '@/components/ui/card'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogOverlay,
	immersiveDialogTitleClass,
} from '@/components/ui/immersive-dialog'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {LOADING_DASH} from '@/constants'
import {useCpuForUi} from '@/hooks/use-cpu'
import {useDiskForUi, useSystemDiskForUi} from '@/hooks/use-disk'
import {useMemoryForUi, useSystemMemoryForUi} from '@/hooks/use-memory'
import {AppT, systemAppsKeyed, useApps} from '@/providers/apps'
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
			<DialogPortal>
				<ImmersiveDialogOverlay />
				<ImmersiveDialogContent size='md' showScroll>
					<h1 className={immersiveDialogTitleClass}>{title}</h1>
					<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
						<LiveUsageContent />
					</ErrorBoundary>
				</ImmersiveDialogContent>
			</DialogPortal>
		</ImmersiveDialog>
	)
}

type SelectedTab = 'storage' | 'memory' | 'cpu'

function LiveUsageContent() {
	const {search} = useLocation()
	const navigate = useNavigate()
	const queryParams = new URLSearchParams(search)
	const selectedTab = (queryParams.get('tab') as SelectedTab) || 'cpu'

	const setSelectedTab = (tab: SelectedTab) => {
		queryParams.set('tab', tab)
		navigate({search: queryParams.toString()})
	}

	// Poll for cpu and memory usage, but do not poll for disk usage
	// As disk-usage doesn't change much in real-time but the calculation causes
	// CPU spikes
	const cpuUsage = useCpuForUi({poll: true})
	const memoryUsage = useSystemMemoryForUi({poll: true})
	const diskUsage = useSystemDiskForUi()

	// Initialize cpu and memory charts with 30 "0" values so there's a clean base line from where they start populating with
	const [cpuChartData, setCpuChartData] = useState<Array<{value: number}>>(new Array(30).fill({value: 0}))
	const [memoryChartData, setMemoryChartData] = useState<Array<{value: number}>>(new Array(30).fill({value: 0}))

	// Update cpu and memory charts whenever their progress values update
	useEffect(() => {
		setCpuChartData((prevData: Array<{value: number}>) => [...prevData.slice(1), {value: cpuUsage.progress * 100 || 0}])
	}, [cpuUsage.progress])

	useEffect(() => {
		setMemoryChartData((prevData: Array<{value: number}>) => [
			...prevData.slice(1),
			{value: memoryUsage.progress * 100 || 0},
		])
	}, [memoryUsage.progress])

	return (
		<div className='grid gap-y-5'>
			{/* Hidden on mobile, as we show regular tabs */}
			<div className='hidden columns-3 sm:block'>
				<button className='block w-full text-left focus:outline-none' onClick={() => setSelectedTab('cpu')}>
					<UsageCard
						title={t('cpu')}
						value={cpuUsage.value}
						progressLabel={cpuUsage.secondaryValue}
						progress={cpuUsage.progress}
						active={selectedTab === 'cpu'}
						chart={cpuChartData}
					/>
				</button>
				<button className='block w-full text-left focus:outline-none' onClick={() => setSelectedTab('memory')}>
					<UsageCard
						title={t('memory')}
						value={memoryUsage.value}
						valueSub={memoryUsage.valueSub}
						progressLabel={memoryUsage.secondaryValue}
						progress={memoryUsage.progress}
						rightChildren={memoryUsage.isMemoryLow && <ErrorMessage>{t('memory.low')}</ErrorMessage>}
						active={selectedTab === 'memory'}
						chart={memoryChartData}
					/>
				</button>
				<button className='block w-full text-left focus:outline-none' onClick={() => setSelectedTab('storage')}>
					<UsageCard
						title={t('storage')}
						value={diskUsage.value}
						valueSub={diskUsage.valueSub}
						progressLabel={diskUsage.secondaryValue}
						progress={diskUsage.progress}
						rightChildren={
							<>
								{diskUsage.isDiskLow && <ErrorMessage>{t('storage.low')}</ErrorMessage>}
								{diskUsage.isDiskFull && <ErrorMessage>{t('storage.full')}</ErrorMessage>}
							</>
						}
						active={selectedTab === 'storage'}
					/>
				</button>
			</div>

			{/* Shown only on mobile */}
			<div className='sm:hidden'>
				<SegmentedControl
					size='lg'
					tabs={[
						{id: 'cpu', label: t('cpu')},
						{id: 'memory', label: t('memory')},
						{id: 'storage', label: t('storage')},
					]}
					value={selectedTab}
					onValueChange={setSelectedTab}
				/>
			</div>

			{/* Key to make sure we reset the error */}
			<ErrorBoundary key={selectedTab} FallbackComponent={ErrorBoundaryCardFallback}>
				{selectedTab === 'cpu' && <CpuSection />}
				{selectedTab === 'memory' && <MemorySection />}
				{selectedTab === 'storage' && <StorageSection />}
			</ErrorBoundary>
		</div>
	)
}
// ---

function StorageSection() {
	const {isLoading, value, valueSub, secondaryValue, progress, isDiskLow, isDiskFull, apps} = useDiskForUi({
		poll: true,
	})

	return (
		<>
			<div className='sm:hidden'>
				<UsageCard
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
			</div>
			{isLoading && <AppListSkeleton systemApps={[systemAppsKeyed.UMBREL_system, systemAppsKeyed.UMBREL_files]} />}
			<AppList apps={apps} formatValue={(v) => maybePrettyBytes(v)} />
		</>
	)
}

function MemorySection() {
	const {isLoading, value, valueSub, secondaryValue, progress, isMemoryLow, apps} = useMemoryForUi({poll: true})

	return (
		<>
			<div className='sm:hidden'>
				<UsageCard
					value={value}
					valueSub={valueSub}
					progressLabel={secondaryValue}
					progress={progress}
					rightChildren={isMemoryLow && <ErrorMessage>{t('memory.low')}</ErrorMessage>}
				/>
			</div>
			{isLoading && <AppListSkeleton systemApps={[systemAppsKeyed.UMBREL_system]} />}
			<AppList apps={apps} formatValue={(v) => maybePrettyBytes(v)} />
		</>
	)
}

function CpuSection() {
	const {isLoading, value, secondaryValue, progress, apps} = useCpuForUi({poll: true})

	return (
		<>
			<div className='sm:hidden'>
				<UsageCard value={value} progressLabel={secondaryValue} progress={progress} />
			</div>
			{isLoading && <AppListSkeleton systemApps={[systemAppsKeyed.UMBREL_system]} />}
			<AppList apps={apps} formatValue={(v) => formatNumberI18n(v) + '%'} />
		</>
	)
}

function UsageCard({
	active,
	title,
	value,
	valueSub,
	progressLabel,
	progress = 0,
	rightChildren,
	chart,
}: {
	active?: boolean
	title?: string
	value?: string
	valueSub?: string
	progressLabel?: string
	progress?: number
	rightChildren?: ReactNode
	chart?: Array<any>
}) {
	return (
		<motion.div className='relative p-[2px]'>
			<motion.div
				className='absolute left-0 top-0 z-[-1] h-full w-full rounded-[12px] bg-gradient-to-b from-brand/90 to-brand/15'
				initial={{opacity: 0}}
				animate={{opacity: active ? 1 : 0}}
				transition={active ? {duration: 0.3, delay: 0.1} : {duration: 0.3}}
			/>
			<motion.div
				className='relative translate-x-0 translate-y-0 transform overflow-hidden rounded-12'
				initial={{backgroundColor: 'rgba(30, 30, 30, 0)'}}
				animate={{backgroundColor: active ? 'rgba(30, 30, 30, 1)' : 'rgba(30, 30, 30, 0)'}}
				transition={active ? {duration: 0.3} : {duration: 0.3, delay: 0.1}}
			>
				<motion.div
					className='absolute left-0 top-0 z-[0] h-full w-full rounded-[12px] bg-gradient-to-b from-brand/15 to-brand/0'
					initial={{opacity: 0}}
					animate={{opacity: active ? 1 : 0}}
					transition={active ? {duration: 0.3, delay: 0.05} : {duration: 0.3}}
				/>
				{chart && (
					<ResponsiveContainer
						style={{position: 'absolute', bottom: -1, left: '-0.5%', zIndex: 0, borderRadius: 12}}
						width='101%'
						height='100%'
					>
						<AreaChart data={chart} margin={{bottom: 0}}>
							<defs>
								<linearGradient id={`${title}GradientChartColor`} x1='0' y1='0' x2='0' y2='1'>
									<stop
										offset='5%'
										style={{stopColor: active ? 'hsl(var(--color-brand) / 0.3)' : 'rgba(255, 255, 255, 0.05)'}}
									/>
									<stop
										offset='95%'
										style={{stopColor: active ? 'hsl(var(--color-brand) / 0)' : 'rgba(255, 255, 255, 0)'}}
									/>
								</linearGradient>
							</defs>
							<YAxis domain={[0, 100]} hide={true} />
							<XAxis hide={true} />
							<Area
								isAnimationActive={false}
								type='monotone'
								dataKey='value'
								style={{stroke: active ? 'hsl(var(--color-brand) / 0.2)' : 'rgba(255, 255, 255, 0.05)'}}
								fillOpacity={1}
								fill={`url(#${title}GradientChartColor)`}
								legendType='none'
								dot={false}
							/>
						</AreaChart>
					</ResponsiveContainer>
				)}
				<Card className={`flex flex-col gap-3`}>
					<div className='hidden items-center justify-between gap-2 sm:flex'>
						<span className='leading-2 text-[0.8rem] font-bold opacity-40'>{title || ''}</span>
						{rightChildren}
					</div>
					<div className='flex min-w-0 items-end gap-1 text-24 font-semibold leading-none -tracking-3 opacity-80'>
						<span className='min-w-0 truncate'>{value ?? LOADING_DASH}</span>
						<span className='min-w-0 flex-1 truncate text-13 font-bold opacity-[45%]'>{valueSub}</span>
					</div>
					<div className='flex flex-col gap-2'>
						<div className='text-13 font-semibold -tracking-2 opacity-40'>{progressLabel}</div>
						<Progress value={progress * 100} variant='primary' />
					</div>
				</Card>
			</motion.div>
		</motion.div>
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

function AppList({apps, formatValue}: {apps?: {id: string; used: number}[]; formatValue: (value: number) => string}) {
	const {userAppsKeyed} = useApps()

	if (userAppsKeyed === undefined) return null
	if (!apps || apps.length === 0) return null

	return (
		<div className={appListClass}>
			{apps?.map(({id, used}) => {
				let icon = userAppsKeyed[id]?.icon
				let title = userAppsKeyed[id]?.name || t('unknown-app')
				if (id === 'umbreld-system') {
					icon = systemAppsKeyed.UMBREL_system.icon
					title = systemAppsKeyed.UMBREL_system.name
				}
				if (id === 'umbreld-files') {
					icon = systemAppsKeyed.UMBREL_files.icon
					title = systemAppsKeyed.UMBREL_files.name
				}
				return <AppListRow key={id} icon={icon} title={title} value={formatValue(used)} />
			})}
		</div>
	)
}

export function AppListSkeleton({systemApps}: {systemApps?: Array<AppT>}) {
	const {userApps} = useApps()
	// Show a list of user-installed and system apps
	// with no values
	return (
		<div className={appListClass}>
			{[...(systemApps || []), ...(userApps || [])].map((app) => {
				return <AppListRow key={app.id} title={app.name} icon={app.icon} value='' />
			})}
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
