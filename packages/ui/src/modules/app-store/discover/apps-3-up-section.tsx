import {useRef} from 'react'
import {Link} from 'react-router-dom'
import {useCss} from 'react-use'

import {AppIcon} from '@/components/app-icon'
import {useColorThief} from '@/hooks/use-color-thief'
import {cardClass, SectionTitle} from '@/modules/app-store/shared'
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
				'flex flex-wrap items-center justify-center gap-x-16 gap-y-8 overflow-hidden text-center xl:flex-nowrap xl:justify-start xl:text-left',
			)}
		>
			<div className={cn('flex flex-col items-center xl:items-start', textLocation === 'right' && 'order-2')}>
				<SectionTitle overline={overline} title={title} />
				<p className='mt-2.5 max-w-md text-14 opacity-60'>{description}</p>
				<div className='pt-5' />
				{children}
			</div>
			<div className='flex gap-5'>
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

	const linkClass = useCss({
		'&:hover': {
			img: {
				viewTransitionName: 'app-icon-' + app.id,
			},
			h3: {
				viewTransitionName: 'app-name-' + app.id,
			},
			p: {
				viewTransitionName: 'app-tagline-' + app.id,
			},
		},
	})

	return (
		<div className='relative'>
			<Link
				to={`/app-store/${app.id}`}
				className={cn(
					'flex h-[268px] w-40 flex-col justify-stretch rounded-24 bg-white/10 px-3 py-4',
					linkClass,
					className,
				)}
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
