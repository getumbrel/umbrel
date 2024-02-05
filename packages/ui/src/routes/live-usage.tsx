import {ReactNode} from 'react'

import {AppIcon} from '@/components/app-icon'
import {Card} from '@/components/ui/card'
import {DebugOnly} from '@/components/ui/debug-only'
import {ImmersiveDialog, immersiveDialogTitleClass} from '@/components/ui/immersive-dialog'
import {useApps} from '@/hooks/use-apps'
import {useDiskForUi} from '@/hooks/use-disk'
import {useMemoryForUi} from '@/hooks/use-memory'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {StatText} from '@/modules/widgets/shared/stat-text'
import {Progress} from '@/shadcn-components/ui/progress'
import {cn} from '@/shadcn-lib/utils'
import {useDialogOpenProps} from '@/utils/dialog'
import {maybePrettyBytes} from '@/utils/pretty-bytes'
import {tw} from '@/utils/tw'

export default function LiveUsageDialog() {
	const title = 'Live Usage'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('live-usage')

	return (
		<ImmersiveDialog {...dialogProps}>
			<h1 className={immersiveDialogTitleClass}>{title}</h1>
			<LiveUsageContent />
		</ImmersiveDialog>
	)
}

function LiveUsageContent() {
	const {allAppsKeyed} = useApps()
	const {apps: appStorageUsages} = useDiskForUi({poll: true})
	const {apps: appMemoryUsages} = useMemoryForUi({poll: true})

	if (!allAppsKeyed) return null

	return (
		<div className='grid gap-4 md:grid-cols-2'>
			<LiveUsageSection title='Storage'>
				<StorageCard />
				<div className={appListClass}>
					{appStorageUsages?.map(({id, used}) => (
						<AppListRow
							key={id}
							icon={allAppsKeyed[id]?.icon || undefined}
							title={allAppsKeyed[id]?.name || 'Unknown app'}
							value={maybePrettyBytes(used)}
						/>
					))}
				</div>
			</LiveUsageSection>
			<LiveUsageSection title='Memory'>
				<MemoryCard />
				<div className={appListClass}>
					{appMemoryUsages?.map(({id, used}) => (
						<AppListRow
							key={id}
							icon={allAppsKeyed[id]?.icon || undefined}
							title={allAppsKeyed[id]?.name || 'Unknown app'}
							value={maybePrettyBytes(used)}
						/>
					))}
				</div>
			</LiveUsageSection>
			<DebugOnly>Live usage stubbed out for bitcoin, lightning, and nostr</DebugOnly>
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

// ---

function LiveUsageSection({title, children}: {title: string; children: React.ReactNode}) {
	return (
		<div className='flex flex-col gap-3'>
			<h2 className='text-17 font-semibold -tracking-2 text-white/80'>{title}</h2>
			{children}
		</div>
	)
}

function StorageCard() {
	const {value, valueSub, secondaryValue, progress, isDiskLow, isDiskFull} = useDiskForUi({poll: true})

	return (
		<ProgressCard
			value={value}
			valueSub={valueSub}
			progressLabel={secondaryValue}
			progress={progress}
			rightChildren={
				<>
					{isDiskLow && <ErrorMessage>Running low on space</ErrorMessage>}
					{isDiskFull && <ErrorMessage>Disk is full</ErrorMessage>}
				</>
			}
		/>
	)
}

function MemoryCard() {
	const {value, valueSub, secondaryValue, progress, isMemoryLow} = useMemoryForUi({poll: true})

	return (
		<ProgressCard
			value={value}
			valueSub={valueSub}
			progressLabel={secondaryValue}
			progress={progress}
			rightChildren={isMemoryLow && <ErrorMessage>Running low on memory</ErrorMessage>}
		/>
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
				<StatText value={value} valueSub={valueSub} />
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
