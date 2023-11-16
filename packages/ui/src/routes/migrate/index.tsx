import * as ProgressPrimitive from '@radix-ui/react-progress'
import {motion} from 'framer-motion'
import {useEffect} from 'react'
import {TbAlertTriangleFilled} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'
import {isNil} from 'remeda'

import UmbrelLogo from '@/assets/umbrel-logo'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {cn} from '@/shadcn-lib/utils'
import {trpcReact} from '@/trpc/trpc'

import {migrateContainerClass, migrateTitleClass} from './_shared'

export default function Migrate() {
	const navigate = useNavigate()

	const migrationStatusQ = trpcReact.migration.migrationStatus.useQuery()

	useEffect(() => {
		const interval = setInterval(() => {
			migrationStatusQ.refetch()
		}, 500)

		return () => {
			clearInterval(interval)
		}
	})

	const isRunning = !!migrationStatusQ.data?.running
	const progress = migrationStatusQ.data?.progress

	const message = (migrationStatusQ.data?.description || 'Connecting') + '...'
	useUmbrelTitle(message)

	if (migrationStatusQ.data?.error) {
		navigate('/migrate/failed')
	}

	if (!isRunning && progress === 100) {
		navigate('/migrate/success')
	}

	return <MigrateInner progress={progress} message={message} isRunning={isRunning} />
}

export function MigrateInner({
	// onSuccess,
	// onFail,
	progress,
	message,
	// isStarting,
	isRunning,
}: {
	// onSuccess: () => void
	// onFail: () => void
	progress?: number
	message: string
	// isStarting: boolean
	isRunning: boolean
}) {
	// const progress = migrationStatusQ.data?.progress
	// const isRunning = migrationStatusQ.data?.running
	const isStarting = !progress && !isRunning
	// const isRunning = true
	// const isStarting = false

	// const message = (migrationStatusQ.data?.description || 'Connecting') + '...'

	// if (migrationStatusQ.data?.error) {
	// 	// navigate('/migrate/failed')
	// 	onFail()
	// }

	// if (!isRunning && progress === 100) {
	// 	onSuccess()
	// 	// navigate('/migrate/success')
	// }

	return (
		<motion.div
			className={migrateContainerClass}
			initial={{opacity: 0}}
			animate={{opacity: 1}}
			transition={{duration: 0.4, delay: 0.2}}
		>
			<UmbrelLogo />
			<div className='pt-4' />
			<h1 className={migrateTitleClass}>Migration Assistant</h1>
			<div className='pt-[50px]' />
			{/* Show indeterminate value if not running */}
			<Progress value={isStarting ? undefined : progress} />
			<div className='pt-5' />
			<span className='text-15 font-normal leading-none -tracking-2'>{message}</span>
			<div className='flex-1 pt-4' />
			<Alert>Do not turn off your Umbrel Home until the migration is complete</Alert>
		</motion.div>
	)
}

function Progress({value}: {value?: number}) {
	return (
		<ProgressPrimitive.Root
			className={cn(
				'relative h-1.5 w-full overflow-hidden rounded-full bg-white/10 sm:w-[80%]',
				isNil(value) && 'umbrel-bouncing-gradient',
			)}
		>
			<ProgressPrimitive.Indicator
				className='h-full w-full flex-1 rounded-full bg-white transition-all'
				style={{transform: `translateX(-${100 - (value || 0)}%)`}}
			/>
		</ProgressPrimitive.Root>
	)
}

function Alert({children, className}: {children: React.ReactNode; className?: string}) {
	return (
		<div
			className={cn(
				'text-normal flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-14 -tracking-2',
				className,
			)}
		>
			<TbAlertTriangleFilled className='h-5 w-5 shrink-0' />
			<span>{children}</span>
		</div>
	)
}
