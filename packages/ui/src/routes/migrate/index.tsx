import * as ProgressPrimitive from '@radix-ui/react-progress'
import {motion} from 'framer-motion'
import {useEffect, useState} from 'react'
import {TbAlertTriangleFilled} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import UmbrelLogo from '@/assets/umbrel-logo'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {cn} from '@/shadcn-lib/utils'
import {sleep} from '@/utils/misc'

import {migrateContainerClass, migrateTitleClass} from './_shared'

export function Migrate() {
	useUmbrelTitle('Migrating...')
	const navigate = useNavigate()
	const [value, setValue] = useState(0)

	useEffect(() => {
		;(async () => {
			await sleep(400)
			setValue(10)
			await sleep(300)
			setValue(30)
			await sleep(300)
			setValue(60)
			await sleep(300)
			setValue(70)
			await sleep(300)
			const didFail = Math.random() > 0.8
			if (didFail) {
				navigate('/migrate/failed')
			} else {
				navigate('/migrate/success')
			}
		})()
		// Ignoring because we don't want to re-run this effect
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

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
			<Progress value={value} />
			<div className='pt-5' />
			<span className='text-15 font-normal leading-none -tracking-2'>Downloading apps...</span>
			<div className='flex-1 pt-4' />
			<Alert>Do not turn off your Umbrel Home until the migration is complete</Alert>
		</motion.div>
	)
}

function Progress({value}: {value: number}) {
	return (
		<ProgressPrimitive.Root className='relative h-1.5 w-full overflow-hidden rounded-full bg-white/10 sm:w-[80%]'>
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
