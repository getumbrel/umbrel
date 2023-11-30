import {useRef} from 'react'
import {Link} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {useColorThief} from '@/hooks/use-color-thief'
import {cardClass, sectionOverlineClass, sectionTitleClass} from '@/modules/app-store/shared'
import {preloadFirstFewGalleryImages} from '@/modules/app-store/utils'
import {Button} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'
import {RegistryApp} from '@/trpc/trpc'

export type Apps3UpSectionProps = {
	apps: RegistryApp[]
	overline: string
	title: string
	description: string
	textLocation?: 'left' | 'right'
	children: React.ReactNode
}

export const Apps3UpSection: React.FC<Apps3UpSectionProps> = ({
	apps,
	overline,
	title,
	description,
	textLocation = 'left',
	children,
}) => {
	return (
		<div
			className={cn(
				cardClass,
				'flex flex-wrap justify-center gap-x-16 gap-y-8 overflow-hidden p-4 text-center xl:flex-nowrap xl:justify-start xl:text-left',
			)}
		>
			<div
				className={cn(
					'flex w-full flex-col items-center justify-center md:w-auto xl:items-start',
					textLocation === 'right' && 'order-2',
				)}
			>
				<p className={sectionOverlineClass}>{overline}</p>
				<h3 className={sectionTitleClass}>{title}</h3>
				<p className='max-w-md text-14 opacity-60'>{description}</p>
				<div className='pt-5' />
				{children}
			</div>
			<div className='flex justify-center gap-5 md:w-auto'>
				<ColorApp app={apps[0]} />
				<ColorApp app={apps[1]} />
				<ColorApp app={apps[2]} />
			</div>
		</div>
	)
}

function ColorApp({app, className}: {app: RegistryApp; className?: string}) {
	const iconRef = useRef<HTMLImageElement>(null)
	const colors = useColorThief(iconRef)

	return (
		<div
			className={cn(
				'relative opacity-0',
				colors &&
					'opacity-100 duration-200 animate-in fade-in slide-in-from-bottom-3 fill-mode-both [&:nth-child(1)]:delay-100 [&:nth-child(2)]:delay-200 [&:nth-child(3)]:delay-300',
			)}
		>
			<Link
				to={`/app-store/${app.id}`}
				className={cn('flex h-[268px] w-40 flex-col justify-stretch rounded-24 bg-white/10 px-3 py-4', className)}
				style={{
					backgroundImage: colors
						? `linear-gradient(to bottom, ${colors.join(', ')})`
						: 'linear-gradient(to bottom, #24242499, #18181899',
				}}
				unstable_viewTransition
				onMouseEnter={() => preloadFirstFewGalleryImages(app)}
			>
				<AppIcon
					ref={iconRef}
					src={app.icon}
					crossOrigin='anonymous'
					size={128}
					className='shrink-0 self-center rounded-24'
					style={{
						filter: `drop-shadow(0px 8px 12.000000953674316px rgba(31, 33, 36, 0.32))`,
					}}
				/>
				<div className='flex-1' />
				<h3 className='font-16 truncate font-bold'>{app.name}</h3>
				<p className='truncate text-13 -tracking-3 opacity-50'>{app.developer}</p>
				<Button size='sm' variant='secondary' className='mt-2'>
					Install
				</Button>
			</Link>
			{/* <div
				className='absolute -top-4 left-1/2 -translate-x-1/2 rounded-24 bg-neutral-700 p-6'
				style={{
					boxShadow:
						'1px 1px 1px 0px rgba(255, 255, 255, 0.20) inset, -1px -1px 4px 0px rgba(0, 0, 0, 0.06) inset, 0px 8px 16px 0px rgba(0, 0, 0, 0.12)',
				}}
			>
				<AppIcon
					src={app.icon}
					size={128}
					className='relative z-10 shrink-0 rounded-24'
					style={{
						filter: `drop-shadow(0px 8px 12.000000953674316px rgba(31, 33, 36, 0.32))`,
					}}
				/>
			</div> */}
		</div>
	)
}
