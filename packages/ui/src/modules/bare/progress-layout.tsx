import {motion} from 'framer-motion'

import {Alert} from '@/modules/bare/alert'
import {Progress} from '@/modules/bare/progress'
import {bareContainerClass, BareLogoTitle, BareSpacer} from '@/modules/bare/shared'
import {t} from '@/utils/i18n'

export function ProgressLayout({
	title,
	// onSuccess,
	// onFail,
	progress,
	message,
	// isStarting,
	isRunning,
	callout,
}: {
	title: string
	// onSuccess: () => void
	// onFail: () => void
	progress?: number
	message?: string
	// isStarting: boolean
	isRunning: boolean
	callout: string
}) {
	const isStarting = !progress && !isRunning

	// Empty string also gets the default message
	const finalMessage = message || t('connecting')

	return (
		<>
			<motion.div
				className={bareContainerClass}
				initial={{opacity: 0}}
				animate={{opacity: 1}}
				transition={{duration: 0.4, delay: 0.2}}
			>
				<BareLogoTitle>{title}</BareLogoTitle>
				<BareSpacer />
				{/* Show indeterminate value if not running */}
				<Progress value={isStarting ? undefined : progress}>{finalMessage}</Progress>
				<div className='flex-1 pt-4' />
				<Alert>{callout}</Alert>
			</motion.div>
		</>
	)
}
