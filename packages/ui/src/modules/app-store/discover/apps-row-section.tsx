import {useRef} from 'react'
import {Link} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {useColorThief} from '@/hooks/use-color-thief'
import {SectionTitle} from '@/modules/app-store/shared'
import {preloadFirstFewGalleryImages} from '@/modules/app-store/utils'
import {RegistryApp} from '@/trpc/trpc'

export const AppsRowSection = ({overline, title, apps}: {overline: string; title: string; apps: RegistryApp[]}) => {
	return (
		<div>
			<SectionTitle overline={overline} title={title} />
			<div className='umbrel-fade-scroller-x umbrel-hide-scrollbar mt-3 flex flex-row gap-3 overflow-x-auto md:gap-[40px]'>
				{apps.map((app, i) => (
					<App key={app.id} app={app} index={i} />
				))}
			</div>
		</div>
	)
}

function App({app, index}: {app: RegistryApp; index: number}) {
	const iconRef = useRef<HTMLImageElement>(null)
	const colors = useColorThief(iconRef)

	return (
		<Link
			to={`/app-store/${app.id}`}
			onMouseEnter={() => preloadFirstFewGalleryImages(app)}
			className='duration-200 animate-in fade-in slide-in-from-right-10 fill-mode-both'
			style={{animationDelay: `${index * 0.1}s`}}
		>
			<AppIcon
				ref={iconRef}
				// size={100}
				src={app.icon}
				crossOrigin='anonymous'
				className='relative z-10 -mb-[30px] ml-[27px] w-[60px] rounded-12 md:mb-[-50px] md:w-[100px] md:rounded-24'
				style={{
					filter: 'drop-shadow(0px 18px 24px rgba(0, 0, 0, 0.12))',
				}}
			/>
			<div
				className='relative flex h-[150px] w-[267px] flex-col justify-start overflow-hidden rounded-20 p-[27px] md:h-[188px] md:w-[345px]'
				style={{
					background: `linear-gradient(123deg, ${colors ? colors[0] : '#24242499'}, ${
						colors ? colors[1] : '#18181899'
					})`,
				}}
			>
				{/* <div className='absolute inset-0 z-0 bg-red-500'></div> */}
				<h3 className='mt-3 truncate text-24 font-semibold -tracking-3 md:mt-8 md:text-[28px]'>{app.name}</h3>
				<p className='line-clamp-2 text-12 -tracking-4 opacity-70 md:text-16'>{app.tagline}</p>
			</div>
		</Link>
	)
}
