import {ReactNode} from 'react'
import {useNavigate} from 'react-router-dom'

import {Card} from '@/components/ui/card'
import {ImmersiveDialog, immersiveDialogTitleClass} from '@/components/ui/immersive-dialog'
import {useInstalledApps} from '@/hooks/use-installed-apps'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {StatText} from '@/modules/desktop/widgets'
import {Progress} from '@/shadcn-components/ui/progress'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

export default function LiveUsageDialog() {
	const title = 'Live Usage'
	useUmbrelTitle(title)
	const navigate = useNavigate()

	return (
		<ImmersiveDialog onClose={() => navigate('/settings', {preventScrollReset: true})}>
			<h1 className={immersiveDialogTitleClass}>{title}</h1>
			<div className='grid gap-4 md:grid-cols-2'>
				<LiveUsageSection title='Storage'>
					<StorageStats />
				</LiveUsageSection>
				<LiveUsageSection title='Memory'>
					<MemoryStats />
				</LiveUsageSection>
			</div>
		</ImmersiveDialog>
	)
}

function StorageStats() {
	const {installedApps} = useInstalledApps()

	if (!installedApps) return null

	return (
		<>
			<ProgressCard
				value='256 GB'
				valueSub='/ 2 TB'
				progressLabel='1.75 TB left'
				progress={0.875}
				rightChildren={<StorageIndicator />}
			/>
			<div className={appListClass}>
				{installedApps.slice(0, 9).map((app) => (
					<AppListRow icon={app.icon} title={app.name} key={app.id} value='632.8 GB' />
				))}
			</div>
		</>
	)
}

function MemoryStats() {
	const {installedApps} = useInstalledApps()

	if (!installedApps) return null

	return (
		<>
			<ProgressCard value='5.4 GB' valueSub='/ 16 GB' progressLabel='11.4 GB left' progress={0.4} />
			<div className={appListClass}>
				{installedApps.slice(0, 5).map((app) => (
					<AppListRow icon={app.icon} title={app.name} key={app.id} value='632.8 GB' />
				))}
			</div>
		</>
	)
}

const appListClass = tw`divide-y divide-white/6 rounded-12 bg-white/5`

function AppListRow({icon, title, value}: {icon: string; title: string; value: string}) {
	return (
		<div className='flex items-center gap-2 p-3'>
			<img
				src={icon}
				alt={title}
				width={25}
				height={25}
				className='h-[25px] w-[25px] rounded-5 bg-white/10 bg-cover bg-center shadow-md'
				style={{
					backgroundImage: `url(/icons/app-icon-placeholder.svg)`,
				}}
			/>
			<span className='flex-1 truncate text-15 font-medium -tracking-4 opacity-90'>{title}</span>
			<span className='text-15 font-normal -tracking-3'>{value}</span>
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
				<Progress value={progress * 100} />
			</div>
		</Card>
	)
}

function StorageIndicator() {
	return (
		<div className='flex items-center gap-2 text-[#F45A5A]'>
			<div className='h-[5px] w-[5px] animate-pulse rounded-full bg-current ring-3 ring-[#F45A5A]/20'></div>
			<div className={cn('text-13 font-medium -tracking-2', 'leading-inter-trimmed')}>Running low on space</div>
		</div>
	)
}
