import {useMutationState} from '@tanstack/react-query'
import {getMutationKey} from '@trpc/react-query'
import {MoreHorizontal} from 'lucide-react'
import {motion, useReducedMotion} from 'motion/react'
import {Dispatch, ReactNode, SetStateAction, useEffect, useId, useMemo, useRef, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'
import {useLocation, useNavigate} from 'react-router-dom'
import {Area, AreaChart, ResponsiveContainer, XAxis, YAxis} from 'recharts'

import {AppIcon} from '@/components/app-icon'
import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {DialogPortal} from '@/components/ui/dialog'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogOverlay,
	immersiveDialogTitleClass,
} from '@/components/ui/immersive-dialog'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {LOADING_DASH} from '@/constants'
import {MachineAppIcon} from '@/features/machines/components/machine-app-icon'
import {useUninstallMachine} from '@/features/machines/components/machines-list'
import {useMachineActions} from '@/features/machines/hooks/use-machine-actions'
import {useMachine} from '@/features/machines/hooks/use-machines'
import type {Machine, MachineState} from '@/features/machines/types'
import {isMachineStartable} from '@/features/machines/utils'
import {canRestart, canStart, canStop, useAppInstall, useAppState} from '@/hooks/use-app-install'
import {extractIconAccentColor} from '@/hooks/use-color-thief'
import {useCpuForUi} from '@/hooks/use-cpu'
import {useDiskForUi} from '@/hooks/use-disk'
import {useGpuForUi} from '@/hooks/use-gpu'
import {useMemoryForUi, useSystemMemoryForUi} from '@/hooks/use-memory'
import {cn} from '@/lib/utils'
import {useAppUninstall} from '@/modules/apps/use-app-uninstall'
import {AppT, systemAppsKeyed, useApps} from '@/providers/apps'
import {trpcReact, type RouterOutput} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'
import {cleanGpuName, gpuVendorShortName} from '@/utils/gpu'
import {formatNumberI18n} from '@/utils/number'
import {maybePrettyBytes} from '@/utils/pretty-bytes'
import {tw} from '@/utils/tw'

export default function LiveUsageDialog() {
	const {t} = useTranslation()
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

const SELECTED_TABS = ['storage', 'memory', 'cpu', 'gpu'] as const
type SelectedTab = (typeof SELECTED_TABS)[number]

type UsageListItem = {
	id: string
	used: number
	memoryUsed?: number
	entity?: 'machine'
	name?: string
	osId?: string
	/** Padding row for an app with no measured usage (GPU list): no bar, note instead of a value */
	idle?: boolean
}

const usageItemKey = ({id, entity}: Pick<UsageListItem, 'id' | 'entity'>) => `${entity ?? 'app'}-${id}`

const SEGMENT_COLORS = [
	'hsl(var(--color-brand))',
	'#5AC8F5', // blue
	'#BF5AF2', // purple
	'#FFB340', // orange
	'#FF6482', // pink
	'#66D4CF', // teal
	'#FFD426', // yellow
]
const OTHER_SEGMENT_COLOR = 'rgb(255 255 255 / 0.25)'
const MAX_SEGMENTS = 6

const cardSpring = {type: 'spring', duration: 0.2, bounce: 0.15} as const
const listSpring = {type: 'spring', duration: 0.5, bounce: 0.2} as const

// Backfill the initial all-zero baseline with the first real sample so the
// chart doesn't draw a wall that slides across the card for 30 seconds
function appendChartPoint(prev: Array<{value: number}>, value: number) {
	if (value !== 0 && prev.every((point) => point.value === 0)) return new Array<{value: number}>(30).fill({value})
	return [...prev.slice(1), {value}]
}

const EMPTY_CHART_DATA: Array<{value: number}> = new Array(30).fill({value: 0})

// Rolling window of the last 30 samples backing a card's background chart,
// from a flat baseline. Samples on a fixed cadence (matching the 2s usage
// polls) rather than on value change, so steady load keeps the chart moving
// and the time axis stays uniform.
const CHART_SAMPLE_INTERVAL_MS = 2000

function useChartHistory(fraction: number, {enabled = true}: {enabled?: boolean} = {}) {
	const [data, setData] = useState(EMPTY_CHART_DATA)
	const fractionRef = useRef(fraction)
	useEffect(() => {
		fractionRef.current = fraction
	}, [fraction])
	useEffect(() => {
		if (!enabled) return
		const id = setInterval(() => {
			// The usage polls pause while the window is unfocused (TanStack Query
			// default) — pause sampling with them rather than painting a
			// fabricated flat line over the gap
			if (!document.hasFocus()) return
			setData((prev) => appendChartPoint(prev, fractionRef.current * 100 || 0))
		}, CHART_SAMPLE_INTERVAL_MS)
		return () => clearInterval(id)
	}, [enabled])
	return data
}

function LiveUsageContent() {
	const {t} = useTranslation()
	const {search} = useLocation()
	const navigate = useNavigate()
	const queryParams = new URLSearchParams(search)
	// Prefixed with the dialog key so useDialogOpenProps sweeps it away when
	// the dialog closes, like every other dialog-owned param
	const tabParam = queryParams.get('live-usage-tab')
	const requestedTab: SelectedTab = SELECTED_TABS.includes(tabParam as SelectedTab) ? (tabParam as SelectedTab) : 'cpu'

	const setSelectedTab = (tab: SelectedTab) => {
		queryParams.set('live-usage-tab', tab)
		navigate({search: queryParams.toString()})
	}

	// Poll for cpu and memory usage, but do not poll for disk usage
	// As disk-usage doesn't change much in real-time but the calculation causes
	// CPU spikes
	const cpuUsage = useCpuForUi({poll: true})
	const gpuUsage = useGpuForUi({poll: true})
	const selectedTab = requestedTab === 'gpu' && !gpuUsage.isLoading && !gpuUsage.hasGpu ? 'cpu' : requestedTab
	// The card number/chart only need the light meminfo endpoint. The per-app
	// breakdown (docker ps + a cgroup sweep per call in umbreld) is fetched once
	// on open — pre-building every card's segment layer and pinning stable
	// colors — and polls only while the memory tab is active.
	const memorySystem = useSystemMemoryForUi({poll: true})
	const memoryUsage = useMemoryForUi({poll: selectedTab === 'memory'})
	const diskUsage = useDiskForUi()

	const colors = useUsageColors([
		...(cpuUsage.apps ?? []),
		...(memoryUsage.apps ?? []),
		...(diskUsage.apps ?? []),
		...(gpuUsage.apps ?? []),
	])
	const cpuSegments = useSegments({apps: cpuUsage.apps, total: 100, usedFraction: cpuUsage.progress, colors})
	const gpuSegments = useSegments({apps: gpuUsage.apps, total: 100, usedFraction: gpuUsage.progress, colors})
	const memorySegments = useSegments({
		apps: memoryUsage.apps,
		total: memoryUsage.size,
		usedFraction: memorySystem.progress,
		colors,
	})
	const storageSegments = useSegments({
		apps: diskUsage.apps,
		total: diskUsage.size,
		usedFraction: diskUsage.progress,
		colors,
	})

	const cpuChartData = useChartHistory(cpuUsage.progress)
	const memoryChartData = useChartHistory(memorySystem.progress)
	// No point maintaining history no card will ever render
	const gpuChartData = useChartHistory(gpuUsage.progress, {enabled: gpuUsage.hasGpu})

	// With a GPU there are four cards — too many to show every detail at once,
	// so exactly one card is expanded at a time: the hovered (or keyboard-
	// focused) card as a preview of clicking it, otherwise the active one.
	// Compressed cards drop only the "/ total" denominator; a compressed
	// active card also keeps its highlight and breakdown.
	const condensed = gpuUsage.hasGpu
	const [previewTab, setPreviewTab] = useState<SelectedTab | null>(null)
	const expandedTab = previewTab ?? selectedTab

	return (
		<div className='grid gap-y-5'>
			{/* Hidden on mobile, as we show regular tabs */}
			{/* Cards only claim the preview on enter; it clears when the cursor
			    leaves the whole row. Crossing the gap between cards is then not a
			    round-trip through "no preview", which re-expanded the active card
			    for a few frames and made the row judder */}
			<div className='hidden gap-3 sm:flex' onMouseLeave={() => setPreviewTab(null)}>
				<UsageTabButton
					tab='cpu'
					condensed={condensed}
					expanded={expandedTab === 'cpu'}
					onSelect={setSelectedTab}
					onPreview={setPreviewTab}
				>
					<UsageCard
						title={t('cpu')}
						value={cpuUsage.value}
						progressLabel={cpuUsage.secondaryValue}
						segments={cpuSegments}
						progress={cpuUsage.progress}
						active={selectedTab === 'cpu'}
						condensed={condensed}
						expanded={expandedTab === 'cpu'}
						chart={cpuChartData}
					/>
				</UsageTabButton>
				<UsageTabButton
					tab='memory'
					condensed={condensed}
					expanded={expandedTab === 'memory'}
					onSelect={setSelectedTab}
					onPreview={setPreviewTab}
				>
					<UsageCard
						title={t('memory')}
						value={memorySystem.value}
						valueSub={memorySystem.valueSub}
						progressLabel={memorySystem.secondaryValue}
						segments={memorySegments}
						progress={memorySystem.progress}
						rightChildren={memorySystem.isMemoryLow && <ErrorMessage>{t('memory.low')}</ErrorMessage>}
						active={selectedTab === 'memory'}
						condensed={condensed}
						expanded={expandedTab === 'memory'}
						chart={memoryChartData}
					/>
				</UsageTabButton>
				<UsageTabButton
					tab='storage'
					condensed={condensed}
					expanded={expandedTab === 'storage'}
					onSelect={setSelectedTab}
					onPreview={setPreviewTab}
				>
					<UsageCard
						title={t('storage')}
						value={diskUsage.value}
						valueSub={diskUsage.valueSub}
						progressLabel={diskUsage.secondaryValue}
						segments={storageSegments}
						progress={diskUsage.progress}
						rightChildren={
							<>
								{diskUsage.isDiskLow && <ErrorMessage>{t('storage.low')}</ErrorMessage>}
								{diskUsage.isDiskFull && <ErrorMessage>{t('storage.full')}</ErrorMessage>}
							</>
						}
						active={selectedTab === 'storage'}
						condensed={condensed}
						expanded={expandedTab === 'storage'}
					/>
				</UsageTabButton>
				{gpuUsage.hasGpu && (
					<UsageTabButton
						tab='gpu'
						condensed={condensed}
						expanded={expandedTab === 'gpu'}
						onSelect={setSelectedTab}
						onPreview={setPreviewTab}
					>
						<UsageCard
							title={t('gpu')}
							value={gpuUsage.value}
							progressLabel={gpuUsage.secondaryValue}
							segments={gpuSegments}
							progress={gpuUsage.progress}
							active={selectedTab === 'gpu'}
							condensed={condensed}
							expanded={expandedTab === 'gpu'}
							chart={gpuChartData}
							rightChildren={
								selectedTab === 'gpu' &&
								expandedTab === 'gpu' &&
								gpuUsage.devices.length === 1 && <GpuModelWhisper device={gpuUsage.devices[0]} />
							}
							footer={
								gpuUsage.devices.length === 1 && (
									<GpuVramFooter device={gpuUsage.devices[0]} detailed={expandedTab === 'gpu'} />
								)
							}
						/>
					</UsageTabButton>
				)}
			</div>

			{/* Shown only on mobile */}
			<div className='sm:hidden'>
				<SegmentedControl
					size='lg'
					tabs={[
						{id: 'cpu', label: t('cpu')},
						{id: 'memory', label: t('memory')},
						{id: 'storage', label: t('storage')},
						...(gpuUsage.hasGpu ? [{id: 'gpu' as const, label: t('gpu')}] : []),
					]}
					value={selectedTab}
					onValueChange={setSelectedTab}
				/>
			</div>

			{/* Key to make sure we reset the error */}
			<ErrorBoundary key={selectedTab} FallbackComponent={ErrorBoundaryCardFallback}>
				{selectedTab === 'cpu' && <CpuSection colors={colors} chart={cpuChartData} />}
				{selectedTab === 'memory' && <MemorySection colors={colors} chart={memoryChartData} />}
				{selectedTab === 'storage' && <StorageSection colors={colors} />}
				{selectedTab === 'gpu' && <GpuSection colors={colors} chart={gpuChartData} />}
			</ErrorBoundary>
		</div>
	)
}
// ---

function StorageSection({colors}: {colors: UsageColors}) {
	const {t, i18n} = useTranslation()
	const {isLoading, value, valueSub, secondaryValue, progress, isDiskLow, isDiskFull, apps, size} = useDiskForUi({
		poll: true,
	})
	const segments = useSegments({apps, total: size, usedFraction: progress, colors})
	// Pass undefined rather than an empty fragment: a fragment is always truthy,
	// which would render an empty header row and make this card taller
	const errors =
		isDiskLow || isDiskFull ? (
			<>
				{isDiskLow && <ErrorMessage>{t('storage.low')}</ErrorMessage>}
				{isDiskFull && <ErrorMessage>{t('storage.full')}</ErrorMessage>}
			</>
		) : undefined

	return (
		<>
			<div className='sm:hidden'>
				<UsageCard
					active
					value={value}
					valueSub={valueSub}
					progressLabel={secondaryValue}
					segments={segments}
					rightChildren={errors}
				/>
			</div>
			{isLoading && <AppListSkeleton systemApps={[systemAppsKeyed.UMBREL_system, systemAppsKeyed.UMBREL_files]} />}
			<AppList apps={apps} colors={colors} formatValue={(item) => maybePrettyBytes(item.used, i18n.language)} />
		</>
	)
}

function MemorySection({colors, chart}: {colors: UsageColors; chart?: Array<{value: number}>}) {
	const {t, i18n} = useTranslation()
	const {isLoading, value, valueSub, secondaryValue, progress, isMemoryLow, apps, size} = useMemoryForUi({poll: true})
	const segments = useSegments({apps, total: size, usedFraction: progress, colors})

	return (
		<>
			<div className='sm:hidden'>
				<UsageCard
					active
					value={value}
					valueSub={valueSub}
					progressLabel={secondaryValue}
					segments={segments}
					chart={chart}
					rightChildren={isMemoryLow && <ErrorMessage>{t('memory.low')}</ErrorMessage>}
				/>
			</div>
			{isLoading && <AppListSkeleton systemApps={[systemAppsKeyed.UMBREL_system]} />}
			<AppList apps={apps} colors={colors} formatValue={(item) => maybePrettyBytes(item.used, i18n.language)} />
		</>
	)
}

function CpuSection({colors, chart}: {colors: UsageColors; chart?: Array<{value: number}>}) {
	const {i18n} = useTranslation()
	const {isLoading, value, secondaryValue, progress, apps} = useCpuForUi({poll: true})
	const segments = useSegments({apps, total: 100, usedFraction: progress, colors})

	return (
		<>
			<div className='sm:hidden'>
				<UsageCard active value={value} progressLabel={secondaryValue} segments={segments} chart={chart} />
			</div>
			{isLoading && <AppListSkeleton systemApps={[systemAppsKeyed.UMBREL_system]} />}
			<AppList
				apps={apps}
				colors={colors}
				formatValue={(item) => formatNumberI18n({n: item.used, locale: i18n.language, showDecimals: false}) + '%'}
			/>
		</>
	)
}

type GpuDevice = RouterOutput['system']['gpuUsage']['devices'][number]

function GpuVendorBadge({vendor}: {vendor: string}) {
	return (
		<span className='shrink-0 rounded-4 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white/50'>
			{gpuVendorShortName(vendor)}
		</span>
	)
}

function GpuRing({fraction, className}: {fraction: number; className?: string}) {
	const size = 16
	const stroke = 2.5
	const radius = (size - stroke) / 2
	const circumference = 2 * Math.PI * radius
	return (
		<svg width={size} height={size} className='shrink-0'>
			<circle cx={size / 2} cy={size / 2} r={radius} fill='none' strokeWidth={stroke} className='stroke-white/15' />
			<circle
				cx={size / 2}
				cy={size / 2}
				r={radius}
				fill='none'
				strokeWidth={stroke}
				strokeLinecap='round'
				strokeDasharray={`${circumference * Math.min(1, Math.max(0, fraction))} ${circumference}`}
				transform={`rotate(-90 ${size / 2} ${size / 2})`}
				className={cn('transition-all duration-700', className)}
			/>
		</svg>
	)
}

// Single-GPU identity whisper in the summary card's title row. Like the
// card's warnings, it gives way before the title beside it
function GpuModelWhisper({device}: {device: GpuDevice}) {
	return (
		<span className='min-w-0 shrink-[999] animate-in truncate text-13 font-normal -tracking-2 text-white/30 duration-300 fade-in'>
			{cleanGpuName(device.model)}
		</span>
	)
}

// Shared GPU-memory display policy for the summary footer and the device
// panel: dedicated VRAM when present, otherwise the shared pool; a zero
// dedicated total (some APU carve-outs) counts as unknown, not a divisor.
// The label stays a literal t() ternary at each call site (the translation
// updater discovers keys from literal calls), keyed off `dedicated`.
function gpuMemoryInfo(device: GpuDevice) {
	const dedicated = device.dedicatedMemory
	const shared = device.sharedMemory
	return {
		dedicated,
		shared,
		used: dedicated?.used ?? shared?.used ?? 0,
		total: dedicated?.total && dedicated.total > 0 ? dedicated.total : null,
	}
}

// Single-GPU VRAM readout merged into the summary card (see UsageCard footer).
// While the card is compressed (`detailed` false) only the label and bar stay
// — the byte figures and shared-memory note need more width than a compressed
// card has. Renders nothing when the device reports no memory info at all.
function GpuVramFooter({device, detailed}: {device: GpuDevice; detailed?: boolean}) {
	const {t, i18n} = useTranslation()
	const {dedicated, shared, used, total} = gpuMemoryInfo(device)
	if (!dedicated && !shared) return null
	return (
		<>
			<div className='flex items-baseline justify-between gap-2 text-13 -tracking-2'>
				<span className='font-medium whitespace-nowrap text-white/40'>
					{dedicated ? t('live-usage.vram') : t('live-usage.gpu-shared-memory')}
				</span>
				<span
					className={cn(
						'truncate text-white/45 tabular-nums transition-[max-width,opacity] duration-300 motion-reduce:transition-none',
						detailed ? 'max-w-40 opacity-100' : 'max-w-0 opacity-0',
					)}
				>
					{maybePrettyBytes(used, i18n.language)}
					{total !== null && ` / ${maybePrettyBytes(total, i18n.language)}`}
				</span>
			</div>
			{total !== null && (
				<div className='h-1 overflow-hidden rounded-full bg-white/10'>
					<div
						className='h-full w-full rounded-full bg-white/35 transition-transform duration-700 ease-[steps(14)]'
						style={{transform: `translateX(${(Math.min(1, used / total) - 1) * 100}%)`}}
					/>
				</div>
			)}
			{dedicated && shared && (
				<div
					className={cn(
						'truncate text-12 -tracking-2 text-white/25',
						'overflow-hidden transition-[max-height,opacity,margin] duration-300 motion-reduce:transition-none',
						// -mt-2 swallows the footer's gap while hidden
						detailed ? 'max-h-5 opacity-100' : '-mt-2 max-h-0 opacity-0',
					)}
				>
					{t('live-usage.gpu-shared-with-system', {amount: maybePrettyBytes(shared.used, i18n.language)})}
				</div>
			)}
		</>
	)
}

// Multi-GPU: the detail panel for the chip-selected device. Remounted per
// device (key) so the core chart history restarts from that device's baseline.
function GpuDeviceDetail({device}: {device: GpuDevice}) {
	const {t, i18n} = useTranslation()
	const chart = useChartHistory((device.totalUsed ?? 0) / 100)
	const {dedicated, shared, used, total} = gpuMemoryInfo(device)
	return (
		<div className='settings-edge-material rounded-24 p-5'>
			<div className='flex min-w-0 items-center gap-2'>
				<span className='truncate text-15 font-semibold -tracking-2 text-white/80'>{cleanGpuName(device.model)}</span>
				<GpuVendorBadge vendor={device.vendor} />
			</div>
			<div className='mt-4 grid gap-5 sm:grid-cols-2'>
				<div className='relative overflow-hidden rounded-12'>
					<UsageAreaChart data={chart} active />
					<div className='relative flex flex-col gap-2 pb-6'>
						<span className='text-13 font-medium -tracking-2 text-white/40'>{t('live-usage.gpu-core')}</span>
						<span className='text-20 leading-none font-semibold -tracking-3'>
							{device.totalUsed === null ? LOADING_DASH : `${Math.ceil(device.totalUsed)}%`}
						</span>
					</div>
				</div>
				{(dedicated || shared) && (
					<div className='flex flex-col gap-2'>
						<span className='text-13 font-medium -tracking-2 text-white/40'>
							{dedicated ? t('live-usage.vram') : t('live-usage.gpu-shared-memory')}
						</span>
						<div className='flex min-w-0 items-baseline gap-1.5'>
							<span className='text-20 leading-none font-semibold -tracking-3'>
								{maybePrettyBytes(used, i18n.language)}
							</span>
							{total !== null && (
								<span className='text-13 font-semibold text-white/45'>/ {maybePrettyBytes(total, i18n.language)}</span>
							)}
						</div>
						{total !== null && dedicated && (
							<CompositionBar segments={[]} flat progress={Math.min(1, dedicated.used / total)} />
						)}
						{dedicated && shared && (
							<div className='text-12 -tracking-2 text-white/25'>
								{t('live-usage.gpu-shared-with-system', {amount: maybePrettyBytes(shared.used, i18n.language)})}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	)
}

function GpuSection({colors, chart}: {colors: UsageColors; chart?: Array<{value: number}>}) {
	const {t, i18n} = useTranslation()
	const {userApps} = useApps()
	const {isLoading, value, secondaryValue, progress, apps, devices} = useGpuForUi({poll: true})
	const segments = useSegments({apps, total: 100, usedFraction: progress, colors})
	const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
	const selectedDevice = devices.find((device) => device.id === selectedDeviceId) ?? devices[0]

	// Unlike the other tabs, the GPU list only contains apps that hold a GPU
	// client right now. Pad it with the remaining installed apps so the list
	// reads as a complete answer ("these aren't using it") instead of
	// mysteriously short. Row keys stay stable, so an app that starts using
	// the GPU animates up from the idle block into the measured one.
	const idleApps: UsageListItem[] = (userApps ?? [])
		.filter((app) => !apps.some((item) => item.id === app.id))
		.sort((a, b) => a.name.localeCompare(b.name, i18n.language))
		.map((app) => ({id: app.id, used: 0, idle: true}))

	// The list mirrors the Memory tab: per-app graphics memory only, so bars,
	// values, and ordering all describe one dimension (mixed "% · GB" strings
	// also ragged the row alignment). Compute attribution still colors the
	// summary card's segment bar. Some drivers can't report per-process memory
	// at all (nvidia-smi prints "-" → 0 bytes): with no memory figures anywhere
	// the whole list — values, bars, and ordering — stays on compute share
	// instead of rendering all-zero bars; an individual zero-memory row among
	// measured ones just falls back to its compute share as the value.
	const computeById = new Map(apps.map((item) => [item.id, item.used]))
	const hasMemoryFigures = apps.some((item) => (item.memoryUsed ?? 0) > 0)
	const listApps: UsageListItem[] = hasMemoryFigures
		? [...apps]
				.map((item) => ({...item, used: item.memoryUsed ?? 0}))
				.sort((a, b) => b.used - a.used || (computeById.get(b.id) ?? 0) - (computeById.get(a.id) ?? 0))
		: apps
	const formatListValue = (item: UsageListItem) => {
		if (!hasMemoryFigures) return formatNumberI18n({n: item.used, locale: i18n.language, showDecimals: false}) + '%'
		if (item.used > 0) return maybePrettyBytes(item.used, i18n.language)
		const compute = computeById.get(item.id) ?? 0
		if (compute > 0) return formatNumberI18n({n: compute, locale: i18n.language, showDecimals: false}) + '%'
		return maybePrettyBytes(0, i18n.language)
	}

	return (
		<>
			<div className='sm:hidden'>
				<UsageCard
					active
					value={value}
					progressLabel={secondaryValue}
					segments={segments}
					chart={chart}
					rightChildren={devices.length === 1 && <GpuModelWhisper device={devices[0]} />}
					footer={devices.length === 1 && <GpuVramFooter device={devices[0]} detailed />}
				/>
			</div>
			{/* One GPU: everything lives in the summary card itself. Multiple: the
			    summary shows the total and chips pick which device gets the single
			    detail panel — two GPUs cost no more visual weight than one */}
			{devices.length > 1 && selectedDevice && (
				<>
					<div className='flex flex-wrap gap-2'>
						{devices.map((device) => {
							const isSelected = device.id === selectedDevice.id
							return (
								<button
									key={device.id}
									type='button'
									aria-pressed={isSelected}
									onClick={() => setSelectedDeviceId(device.id)}
									className={cn(
										'flex items-center gap-2 rounded-full border px-3 py-1.5 text-13 -tracking-2 outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-white/20',
										isSelected
											? 'border-brand/40 bg-brand/15 text-white/90'
											: 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10',
									)}
								>
									<GpuRing
										fraction={(device.totalUsed ?? 0) / 100}
										className={isSelected ? 'stroke-brand' : 'stroke-white/50'}
									/>
									<span className='font-medium'>{cleanGpuName(device.model)}</span>
								</button>
							)
						})}
					</div>
					<GpuDeviceDetail key={selectedDevice.id} device={selectedDevice} />
				</>
			)}
			{isLoading && <AppListSkeleton systemApps={[systemAppsKeyed.UMBREL_system]} />}
			{!isLoading && (
				<AppList
					apps={[...listApps, ...idleApps]}
					colors={colors}
					idleLabel={t('live-usage.not-using-gpu')}
					formatValue={formatListValue}
				/>
			)}
		</>
	)
}

// --- Composition bar

type BarSegment = {id: string; label: string; color: string; start: number; width: number}

/**
 * Colors for app and machine segments: an app icon's dominant hue when one is
 * extractable, otherwise a palette color assigned by first appearance.
 * Machines use the palette because their icon is a composed React element.
 * Every item keeps one color in every bar and list for the lifetime of the
 * dialog.
 */
function useUsageColors(items: UsageListItem[]) {
	const resolveItem = useResolveUsageItem()
	const requestedRef = useRef(new Set<string>())
	const paletteSizeRef = useRef(0)
	const [colors, setColors] = useState(() => new Map<string, string>())

	useEffect(() => {
		for (const item of items) {
			const key = usageItemKey(item)
			if (requestedRef.current.has(key)) continue
			const {icon} = resolveItem(item)
			// No icon yet (apps provider still loading) — leave unmarked so we retry
			if (!icon && item.entity !== 'machine') continue
			requestedRef.current.add(key)
			// Every appearing app gets a deterministic fallback immediately, so
			// even rows that never make a bar segment are distinguishable from
			// the gray "Other" catch-all
			const fallback = SEGMENT_COLORS[paletteSizeRef.current++ % SEGMENT_COLORS.length]
			setColors((prev) => new Map(prev).set(key, fallback))
			if (icon) {
				extractIconAccentColor(icon).then((color) => {
					if (color) setColors((prev) => new Map(prev).set(key, color))
				})
			}
		}
	}, [items, resolveItem])

	return useMemo(
		() => ({
			get(item: Pick<UsageListItem, 'id' | 'entity'>) {
				return colors.get(usageItemKey(item))
			},
		}),
		[colors],
	)
}
type UsageColors = ReturnType<typeof useUsageColors>

function useSegments({
	apps,
	total,
	usedFraction,
	colors,
}: {
	apps?: UsageListItem[]
	total?: number
	usedFraction: number
	colors: UsageColors
}): BarSegment[] {
	const {t} = useTranslation()
	const resolveItem = useResolveUsageItem()

	if (!apps || !total) return []

	const segments: BarSegment[] = []
	// Cap the bar at the displayed used figure, not at full bar capacity: the
	// per-app numbers can sum past it (umbreld floors the system share at 2GB),
	// and the bar must never overstate the number next to it
	const usedCap = Math.min(usedFraction, 1)
	let cursor = 0
	for (const app of apps) {
		if (segments.length >= MAX_SEGMENTS) break
		const width = Math.min(app.used / total, usedCap - cursor)
		// Apps are sorted by usage, so everything after the first sliver is smaller
		if (width < 0.004) break
		segments.push({
			id: usageItemKey(app),
			label: resolveItem(app).name,
			// The commit-phase assignment lands one frame after first render; the
			// gray placeholder blends into the assigned color via the bar transition
			color: colors.get(app) ?? OTHER_SEGMENT_COLOR,
			start: cursor,
			width,
		})
		cursor += width
	}
	// Whatever is used but not attributed to a segment above (small apps, system
	// overhead the per-app numbers don't cover)
	const otherWidth = usedCap - cursor
	if (otherWidth > 0.002) {
		segments.push({id: 'other-usage', label: t('other'), color: OTHER_SEGMENT_COLOR, start: cursor, width: otherWidth})
	}
	return segments
}

// `flat` crossfades to a single brand-colored fill of the overall usage, so
// inactive cards read as a plain progress bar and active ones as the breakdown.
// Every bar is full-width and shaped with a transform or a clip-path: the polls
// retune them every second, and a tweening `width`/`left` is a layout on every
// frame. Only the geometry is stepped; the colour and opacity fades stay smooth.
function CompositionBar({segments, flat, progress}: {segments: BarSegment[]; flat?: boolean; progress?: number}) {
	// Prefer the overall usage fraction: it's known before the per-app
	// breakdown arrives, so the flat bar never renders at 0% while waiting
	const flatWidth = Math.min(progress ?? segments.reduce((sum, segment) => sum + segment.width, 0), 1)
	return (
		<div className='relative h-2 overflow-hidden rounded-full bg-white/10'>
			<div
				className={cn(
					'absolute inset-0 rounded-full transition-[transform,opacity] duration-700 [transition-timing-function:steps(14),ease]',
					!flat && 'opacity-0',
				)}
				style={{transform: `translateX(${(flatWidth - 1) * 100}%)`, backgroundColor: 'hsl(var(--color-brand))'}}
			/>
			{segments.map((segment) => (
				<div
					key={segment.id}
					className={cn(
						'absolute inset-0 transition-[clip-path,background-color,opacity] duration-700 [transition-timing-function:steps(14),ease,ease]',
						flat && 'opacity-0',
					)}
					style={{
						// The same box as a `left`/`width` segment — 1px in from each
						// neighbour, at least 2px wide, 3px corners — cut from a full-width
						// element, so retuning it never lays anything out
						clipPath: `inset(0 min(calc(${(1 - segment.start - segment.width) * 100}% + 1px), calc(${(1 - segment.start) * 100}% - 3px)) 0 calc(${segment.start * 100}% + 1px) round 3px)`,
						backgroundColor: segment.color,
					}}
				/>
			))}
			{/* Tooltip anchors: the painted segments are full-width and only clipped,
			    so Radix would centre the label on the whole bar. Shape these with a
			    transform instead — hit-testing and getBoundingClientRect both follow
			    it, and it's still compositor-only. */}
			{!flat &&
				segments.map((segment) => (
					<DarkTooltip key={segment.id} label={segment.label}>
						<div
							className='absolute inset-0 origin-left transition-transform duration-700 [transition-timing-function:steps(14)]'
							style={{transform: `translateX(${segment.start * 100}%) scaleX(${segment.width})`}}
						/>
					</DarkTooltip>
				))}
		</div>
	)
}

// --- Usage cards

function UsageTabButton({
	tab,
	condensed,
	expanded,
	onSelect,
	onPreview,
	children,
}: {
	tab: SelectedTab
	condensed: boolean
	expanded: boolean
	onSelect: (tab: SelectedTab) => void
	onPreview: Dispatch<SetStateAction<SelectedTab | null>>
	children: ReactNode
}) {
	const reduceMotion = Boolean(useReducedMotion())
	return (
		<motion.button
			type='button'
			onClick={() => onSelect(tab)}
			// No mouseleave: the row container clears the preview once the cursor
			// leaves it entirely, so gap-crossing between cards doesn't judder
			onMouseEnter={() => onPreview(tab)}
			onFocus={() => onPreview(tab)}
			// Only clear a preview this card owns: the next card's focus may have
			// already claimed it by the time this card's blur fires
			onBlur={() => onPreview((current) => (current === tab ? null : current))}
			whileTap={reduceMotion ? undefined : {scale: 0.98}}
			transition={cardSpring}
			className={cn(
				'h-full shrink basis-0 rounded-24 text-left outline-hidden will-change-transform focus-visible:ring-2 focus-visible:ring-white/20',
				'transition-[flex-grow] duration-300 ease-out motion-reduce:transition-none',
				// Inactive cards take 21.5% of the row each (but never squeeze below
				// 134px), the expanded card the remaining ~35.5%. The total stays
				// constant when a hover moves the expansion between cards, so
				// bystanders don't move
				condensed && !expanded ? 'min-w-[134px] grow' : 'min-w-0',
				condensed && expanded ? 'grow-[1.65]' : 'grow',
			)}
		>
			{children}
		</motion.button>
	)
}

// Background area chart shared by the summary cards and the GPU device panel
function UsageAreaChart({data, active, preview}: {data: Array<{value: number}>; active?: boolean; preview?: boolean}) {
	// A localized title could contain characters that are invalid in url(#…)
	// references (and titles repeat across cards), so use a generated id
	const chartGradientId = `${useId()}-chart-gradient`
	return (
		<ResponsiveContainer
			style={{position: 'absolute', bottom: -1, left: '-0.5%', zIndex: 0}}
			width='101%'
			height='100%'
		>
			<AreaChart data={data} margin={{bottom: 0}}>
				<defs>
					<linearGradient id={chartGradientId} x1='0' y1='0' x2='0' y2='1'>
						<stop
							offset='5%'
							style={{
								stopColor: active
									? 'hsl(var(--color-brand) / 0.3)'
									: preview
										? 'rgba(255, 255, 255, 0.12)'
										: 'rgba(255, 255, 255, 0.05)',
							}}
						/>
						<stop offset='95%' style={{stopColor: active ? 'hsl(var(--color-brand) / 0)' : 'rgba(255, 255, 255, 0)'}} />
					</linearGradient>
				</defs>
				<YAxis domain={[0, 100]} hide={true} />
				<XAxis hide={true} />
				<Area
					isAnimationActive={false}
					type='monotone'
					dataKey='value'
					style={{
						stroke: active
							? 'hsl(var(--color-brand) / 0.2)'
							: preview
								? 'rgba(255, 255, 255, 0.15)'
								: 'rgba(255, 255, 255, 0.05)',
					}}
					fillOpacity={1}
					fill={`url(#${chartGradientId})`}
					legendType='none'
					dot={false}
				/>
			</AreaChart>
		</ResponsiveContainer>
	)
}

function UsageCard({
	active,
	condensed,
	expanded,
	title,
	value,
	valueSub,
	progressLabel,
	segments,
	progress,
	rightChildren,
	chart,
	footer,
}: {
	active?: boolean
	/** Desktop GPU row: only the expanded card shows the valueSub denominator */
	condensed?: boolean
	expanded?: boolean
	title?: string
	value?: string
	valueSub?: string
	progressLabel?: string
	segments: BarSegment[]
	progress?: number
	rightChildren?: ReactNode
	chart?: Array<{value: number}>
	/** Extra block under the bar (e.g. single-GPU VRAM); collapses while the card is inactive */
	footer?: ReactNode
}) {
	const hideExtras = condensed && !expanded
	// Hover/focus preview: a whisper of the active treatment in neutral white
	// so the card reads clickable without competing with the brand highlight
	const preview = expanded && !active
	return (
		<div className='settings-edge-material relative h-full overflow-hidden rounded-24 p-5'>
			<div
				className={cn(
					'pointer-events-none absolute inset-0 bg-linear-to-b from-brand/15 to-transparent transition-opacity duration-300',
					active ? 'opacity-100' : 'opacity-0',
				)}
			/>
			<div
				className={cn(
					'pointer-events-none absolute inset-0 rounded-24 border border-white/15 bg-linear-to-b from-white/5 to-transparent transition-opacity duration-300',
					preview ? 'opacity-100' : 'opacity-0',
				)}
			/>
			{chart && <UsageAreaChart data={chart} active={active} preview={preview} />}
			<div className='relative flex h-full flex-col gap-3'>
				{title && (
					<div className='flex min-w-0 items-center justify-between gap-2 text-13 -tracking-2'>
						<span className='truncate font-semibold text-white/45'>{title}</span>
						{rightChildren}
					</div>
				)}
				<div className='flex min-w-0 items-baseline gap-1.5 text-24 leading-none font-semibold -tracking-3'>
					<span className='min-w-0 truncate'>{value ?? LOADING_DASH}</span>
					{valueSub && (
						<span
							className={cn(
								'min-w-0 truncate text-13 font-semibold text-white/45',
								condensed && 'transition-[max-width,opacity] duration-300 motion-reduce:transition-none',
								condensed && (hideExtras ? 'max-w-0 opacity-0' : 'max-w-24'),
							)}
						>
							{valueSub}
						</span>
					)}
					{/* Without a title row (mobile: the tabs above already name the
					    card), right-side content shares the value line instead of
					    floating alone in an otherwise-empty header row */}
					{!title && rightChildren && (
						<span className='ml-auto flex min-w-0 shrink justify-end text-13 -tracking-2'>{rightChildren}</span>
					)}
				</div>
				{/* mt-auto pins the bar to the card bottom so bars align across
				    condensed cards (no label) and the expanded one (label above) */}
				<div className='mt-auto flex flex-col gap-2'>
					{progressLabel && (
						<div className={cn('text-13 font-medium -tracking-2 text-white/40', condensed && 'truncate')}>
							{progressLabel}
						</div>
					)}
					<CompositionBar segments={segments} flat={!active} progress={progress} />
				</div>
				{footer && (
					<div
						className={cn(
							'flex flex-col gap-2 overflow-hidden transition-all duration-300 motion-reduce:transition-none',
							// -mt-3 swallows the wrapper's gap while collapsed so inactive
							// cards keep their exact height
							active ? 'max-h-16 opacity-100' : '-mt-3 max-h-0 opacity-0',
						)}
					>
						{footer}
					</div>
				)}
			</div>
			<div
				className={cn(
					'pointer-events-none absolute inset-0 rounded-24 border border-brand/40 transition-opacity duration-300',
					active ? 'opacity-100' : 'opacity-0',
				)}
			/>
		</div>
	)
}

// A warning in a card's title row. It wraps and gives way before the title
function ErrorMessage({children}: {children?: ReactNode}) {
	return (
		<div className='flex shrink-[999] items-center gap-2 text-[#F45A5A]'>
			<div className='h-[5px] w-[5px] animate-pulse rounded-full bg-current ring-3 ring-[#F45A5A]/20'></div>
			<div className={cn('text-13 font-medium -tracking-2', 'leading-inter-trimmed')}>{children}</div>
		</div>
	)
}

// --- App list

function useResolveApp() {
	const {t} = useTranslation()
	const {userAppsKeyed} = useApps()

	return useMemo(
		() =>
			(id: string): {name: string; icon?: string; systemApp?: boolean} => {
				if (id === 'umbreld-system') {
					return {name: t('live-usage.system'), icon: systemAppsKeyed.UMBREL_system.icon, systemApp: true}
				}
				if (id === 'umbreld-files') {
					return {name: systemAppsKeyed.UMBREL_files.name, icon: systemAppsKeyed.UMBREL_files.icon, systemApp: true}
				}
				// Apps a member can't see are folded into a single entry server-side
				if (id === 'other') {
					return {name: t('other'), icon: systemAppsKeyed.UMBREL_system.icon, systemApp: true}
				}
				return {name: userAppsKeyed?.[id]?.name || t('unknown-app'), icon: userAppsKeyed?.[id]?.icon}
			},
		[t, userAppsKeyed],
	)
}

function useResolveUsageItem() {
	const {t} = useTranslation()
	const resolveApp = useResolveApp()

	return useMemo(
		() =>
			(item: UsageListItem): {name: string; icon?: string; systemApp?: boolean} =>
				item.entity === 'machine' ? {name: item.name || t('machines')} : resolveApp(item.id),
		[resolveApp, t],
	)
}

function AppList({
	apps,
	formatValue,
	colors,
	idleLabel,
}: {
	apps?: UsageListItem[]
	formatValue: (item: UsageListItem) => string
	colors: UsageColors
	/** Shown in place of the value on `idle` padding rows */
	idleLabel?: string
}) {
	const {userAppsKeyed} = useApps()
	const resolveItem = useResolveUsageItem()
	const userQ = trpcReact.user.get.useQuery()
	// Members see shared apps but can't manage them
	const isMember = userQ.data?.role === 'member'

	// While a row menu is open, render the snapshot from the moment it opened
	// so poll-driven re-sorts can't shuffle the target row away mid-click
	const [frozenApps, setFrozenApps] = useState<UsageListItem[] | null>(null)
	const handleMenuOpenChange = (open: boolean) => setFrozenApps(open && apps ? apps : null)

	if (userAppsKeyed === undefined) return null
	if (!apps || apps.length === 0) return null
	const displayApps = frozenApps ?? apps

	// Apps are sorted by usage, so the first one is the biggest consumer
	const maxUsed = Math.max(displayApps[0]?.used ?? 0, Number.EPSILON)

	return (
		<div className={appListClass}>
			{displayApps.map((item) => {
				const {id, used, entity, osId} = item
				const {name, icon, systemApp} = resolveItem(item)
				// System entries (System, Files, "other") aren't manageable apps
				const isUserApp = entity !== 'machine' && Boolean(userAppsKeyed[id])
				return (
					<AppListRow
						key={usageItemKey(item)}
						icon={icon}
						systemApp={systemApp}
						osId={entity === 'machine' ? osId : undefined}
						machineId={entity === 'machine' ? id : undefined}
						title={name}
						value={item.idle ? '' : formatValue(item)}
						note={item.idle ? idleLabel : undefined}
						barColor={colors.get(item) ?? OTHER_SEGMENT_COLOR}
						barShare={item.idle ? undefined : used / maxUsed}
						status={
							entity === 'machine' ? <MachineRowStatus machineId={id} /> : isUserApp && <AppRowStatus appId={id} />
						}
						menu={
							!isMember &&
							(entity === 'machine' ? (
								<MachineRowMenu machineId={id} onOpenChange={handleMenuOpenChange} />
							) : isUserApp ? (
								<AppRowMenu appId={id} onOpenChange={handleMenuOpenChange} />
							) : (
								<span aria-hidden='true' className='size-7 shrink-0' />
							))
						}
					/>
				)
			})}
		</div>
	)
}

const rowMenuTriggerClass = tw`shrink-0 rounded-full p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white focus:outline-hidden focus-visible:bg-white/10 focus-visible:text-white data-[state=open]:bg-white/10 data-[state=open]:text-white`

// Row menus are compact action lists — use the desktop context menus' tight
// padding instead of the roomier dropdown default
const rowMenuContentClass = tw`p-1`

function AppRowMenu({appId, onOpenChange}: {appId: string; onOpenChange?: (open: boolean) => void}) {
	const {t} = useTranslation()
	const appInstall = useAppInstall(appId)
	const {promptUninstall, dialogs: uninstallDialogs} = useAppUninstall(appId, appInstall)

	const state = appInstall.state
	const startDisabled = !canStart(state)
	const stopDisabled = !canStop(state)
	const restartDisabled = !canRestart(state)

	return (
		<>
			<DropdownMenu onOpenChange={onOpenChange}>
				<DropdownMenuTrigger asChild>
					<button type='button' aria-label={t('live-usage.app-options')} className={rowMenuTriggerClass}>
						<MoreHorizontal className='size-4' />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className={rowMenuContentClass}>
					{/* Restartable covers running and offline (unknown) apps — stopped apps keep it disabled */}
					<DropdownMenuItem disabled={restartDisabled} onSelect={restartDisabled ? undefined : appInstall.restart}>
						{t('restart')}
					</DropdownMenuItem>
					{/* Startable covers both stopped and offline (unknown) apps */}
					{canStart(state) ? (
						<DropdownMenuItem disabled={startDisabled} onSelect={startDisabled ? undefined : appInstall.start}>
							{t('start')}
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem disabled={stopDisabled} onSelect={stopDisabled ? undefined : appInstall.stop}>
							{t('stop')}
						</DropdownMenuItem>
					)}
					<DropdownMenuItem
						className='text-destructive2-lightest focus:text-destructive2-lightest data-[highlighted]:text-destructive2-lightest'
						onSelect={promptUninstall}
					>
						{t('desktop.app.context.uninstall')}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{uninstallDialogs}
		</>
	)
}

// Machine counterpart of AppRowStatus: the state label shown with the name,
// hidden while running, with transient states marked like the app rows
function MachineRowStatus({machineId}: {machineId: string}) {
	const {t} = useTranslation()
	const {machine} = useMachine(machineId)
	// Uninstall has no backend machine state — surface the in-flight mutation
	// (fired from any component) via the shared mutation cache instead
	const uninstallingIds = useMutationState({
		filters: {mutationKey: getMutationKey(trpcReact.machines.uninstall), status: 'pending'},
		select: (mutation) => (mutation.state.variables as {id: string} | undefined)?.id,
	})
	if (uninstallingIds.includes(machineId)) {
		return t('machines.state.uninstalling') + '…'
	}

	if (!machine || machine.state === 'running') return null
	// Keep every key literal: update-translations.js scans source text rather
	// than evaluating dynamic keys. The exhaustive map also makes a new backend
	// state a compile-time decision instead of leaking its raw key into the UI.
	const stateLabels: Record<MachineState, string> = {
		error: t('machines.state.error'),
		installing: t('machines.state.installing'),
		restarting: t('machines.state.restarting'),
		running: t('machines.state.running'),
		starting: t('machines.state.starting'),
		stopped: t('machines.state.stopped'),
		stopping: t('machines.state.stopping'),
		suspended: t('machines.state.suspended'),
	}
	const transient = (['installing', 'starting', 'stopping', 'restarting'] as MachineState[]).includes(machine.state)
	return stateLabels[machine.state] + (transient ? '…' : '')
}

// Power actions for machine rows, mirroring AppRowMenu's shape. Uninstall
// reuses the machines feature's confirmation flow.
function MachineRowMenu({machineId, onOpenChange}: {machineId: string; onOpenChange?: (open: boolean) => void}) {
	const {machine} = useMachine(machineId)
	// The usage row can briefly outlive the machine (e.g. right after uninstall)
	if (!machine) return <span aria-hidden='true' className='size-7 shrink-0' />
	return <MachineRowMenuContent machine={machine} onOpenChange={onOpenChange} />
}

function MachineRowMenuContent({machine, onOpenChange}: {machine: Machine; onOpenChange?: (open: boolean) => void}) {
	const {t} = useTranslation()
	const {start, stop, restart, forceStop} = useMachineActions()
	const promptUninstall = useUninstallMachine(machine)

	const state = machine.state
	// Stopped, suspended, and error states get a one-click start,
	// matching the Machines list's power button
	const startable = isMachineStartable(state)
	const stopDisabled = state !== 'running'
	const restartDisabled = state !== 'running'
	// The escape hatch for any non-stopped state — except 'installing', where
	// uninstall (doubling as cancel-install) is the right action
	const forceStopDisabled = state === 'stopped' || state === 'installing'

	return (
		<DropdownMenu onOpenChange={onOpenChange}>
			<DropdownMenuTrigger asChild>
				<button type='button' aria-label={t('machines.machine-options')} className={rowMenuTriggerClass}>
					<MoreHorizontal className='size-4' />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className={rowMenuContentClass}>
				<DropdownMenuItem
					disabled={restartDisabled}
					onSelect={restartDisabled ? undefined : () => restart({id: machine.id})}
				>
					{t('machines.restart')}
				</DropdownMenuItem>
				{startable ? (
					<DropdownMenuItem onSelect={() => start({id: machine.id})}>{t('machines.turn-on')}</DropdownMenuItem>
				) : (
					<DropdownMenuItem disabled={stopDisabled} onSelect={stopDisabled ? undefined : () => stop({id: machine.id})}>
						{t('machines.shut-down')}
					</DropdownMenuItem>
				)}
				<DropdownMenuItem
					disabled={forceStopDisabled}
					className='text-destructive2-lightest focus:text-destructive2-lightest data-[highlighted]:text-destructive2-lightest'
					onSelect={forceStopDisabled ? undefined : () => forceStop({id: machine.id})}
				>
					{t('machines.force-shut-down')}
				</DropdownMenuItem>
				<DropdownMenuItem
					className='text-destructive2-lightest focus:text-destructive2-lightest data-[highlighted]:text-destructive2-lightest'
					onSelect={promptUninstall}
				>
					{t('machines.uninstall')}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

// Helper text shown with the app name while the app is in a transient
// state, mirroring the desktop icon labels
function AppRowStatus({appId}: {appId: string}) {
	const {t} = useTranslation()
	// Display-only: read from the shared apps list instead of mounting a
	// per-app state controller for every row
	const state = useAppState(appId)

	let text: string | undefined
	switch (state) {
		case 'installing':
			text = t('app.installing') + '…'
			break
		case 'starting':
			text = t('app.starting') + '…'
			break
		case 'restarting':
			text = t('app.restarting') + '…'
			break
		case 'stopping':
			text = t('app.stopping') + '…'
			break
		case 'uninstalling':
			text = t('app.uninstalling') + '…'
			break
		case 'updating':
			text = t('app.updating') + '…'
			break
		case 'stopped':
			text = t('app.stopped')
			break
		case 'unknown':
			text = t('app.offline')
			break
	}
	return text ?? null
}

export function AppListSkeleton({systemApps}: {systemApps?: Array<AppT>}) {
	const {t} = useTranslation()
	const {userApps} = useApps()
	// Show a list of user-installed and system apps
	// with no values
	return (
		<div className={appListClass}>
			{[...(systemApps || []), ...(userApps || [])].map((app) => {
				return (
					<AppListRow
						key={app.id}
						// Named as in the loaded list
						title={app.id === systemAppsKeyed.UMBREL_system.id ? t('live-usage.system') : app.name}
						icon={app.icon}
						systemApp={'systemApp' in app && app.systemApp}
						value=''
					/>
				)
			})}
		</div>
	)
}

const appListClass = tw`settings-edge-material overflow-hidden rounded-24`

function AppListRow({
	icon,
	systemApp,
	osId,
	machineId,
	title,
	value,
	note,
	disabled,
	barColor,
	barShare,
	status,
	menu,
}: {
	icon?: string
	systemApp?: boolean
	osId?: string
	/** Set for machine rows so the icon can reflect the machine's power state */
	machineId?: string
	title: string
	value: string
	/** Muted annotation shown in place of the value (e.g. "Not using GPU") */
	note?: string
	disabled?: boolean
	barColor?: string
	barShare?: number
	status?: ReactNode
	menu?: ReactNode
}) {
	const reduceMotion = Boolean(useReducedMotion())
	const {machine} = useMachine(machineId)
	return (
		<motion.div
			layout={reduceMotion ? false : 'position'}
			transition={listSpring}
			// Rows carry their own separator so it travels with them when they
			// re-sort; a container divide-y would stay pinned to the old positions
			className={cn(
				'flex min-w-0 items-center gap-2 border-b border-white/6 p-3 last:border-b-0',
				disabled && 'opacity-50',
			)}
		>
			{osId ? (
				<MachineAppIcon osId={osId} state={machine?.state} className={cn('size-7', disabled && 'grayscale')} />
			) : (
				<AppIcon
					src={icon}
					size={28}
					className={cn('rounded-8 shadow-md', systemApp && 'border-0', disabled && 'grayscale')}
				/>
			)}
			{/* The name comes first. On a phone the status goes under it, and on wider
			    screens the status is what truncates when the two don't fit */}
			<div className='flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-1.5'>
				<span className='min-w-0 truncate text-15 leading-tight font-medium -tracking-4 opacity-90'>{title}</span>
				<span className='min-w-0 shrink-[999] truncate text-13 leading-tight -tracking-2 text-white/40 empty:hidden'>
					{status}
				</span>
			</div>
			{barShare !== undefined && (
				<span className='h-1 w-14 shrink-0 overflow-hidden rounded-full bg-white/10 sm:w-24'>
					<span
						className='block h-full w-full rounded-full transition-[transform,background-color] duration-700 [transition-timing-function:steps(14),ease]'
						style={{
							transform: `translateX(${(Math.max(0, Math.min(1, barShare)) - 1) * 100}%)`,
							backgroundColor: barColor,
						}}
					/>
				</span>
			)}
			{note ? (
				<span className='shrink-0 text-right text-13 font-normal -tracking-2 text-white/30'>{note}</span>
			) : (
				<span className='shrink-0 text-right text-15 font-normal -tracking-3 text-white/45 uppercase tabular-nums sm:min-w-[76px]'>
					{value}
				</span>
			)}
			{menu}
		</motion.div>
	)
}
