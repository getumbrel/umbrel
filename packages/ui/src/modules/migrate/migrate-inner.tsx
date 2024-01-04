import {motion} from 'framer-motion'

import {Alert} from '@/modules/bare/alert'
import {Progress} from '@/modules/bare/progress'
import {bareContainerClass, BareLogoTitle, BareSpacer} from '@/modules/bare/shared'

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
			className={bareContainerClass}
			initial={{opacity: 0}}
			animate={{opacity: 1}}
			transition={{duration: 0.4, delay: 0.2}}
		>
			<BareLogoTitle>Migration Assistant</BareLogoTitle>
			<BareSpacer />
			{/* Show indeterminate value if not running */}
			<Progress value={isStarting ? undefined : progress}>{message}</Progress>
			<div className='flex-1 pt-4' />
			<Alert>Do not turn off your device until the migration is complete</Alert>
		</motion.div>
	)
}
