import {useRef} from 'react'
import {Link} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {AppT} from '@/hooks/use-available-apps'
import {useColorThief} from '@/hooks/use-color-thief'

import {AppsSectionProps} from './apps-grid-section'
import {SectionTitle} from './shared'

export const AppsRowSection: React.FC<AppsSectionProps> = ({overline, title, apps}) => {
	return (
		<div>
			<div className='px-[30px]'>
				<SectionTitle overline={overline} title={title} />
			</div>
			<div className='umbrel-fade-scroller-x umbrel-hide-scrollbar mt-[30px] flex flex-row gap-[40px] overflow-x-auto pl-[30px]'>
				{apps.map((app) => (
					<App key={app.id} app={app} />
				))}
			</div>
		</div>
	)
}

function App({app}: {app: AppT}) {
	const iconRef = useRef<HTMLImageElement>(null)
	const colors = useColorThief(iconRef)

	return (
		<Link to={`/app-store/${app.id}`}>
			<AppIcon
				ref={iconRef}
				size={100}
				src={app.icon}
				className='relative z-10 -mb-[50px] ml-[27px] rounded-24'
				style={{
					filter: 'drop-shadow(0px 18px 24px rgba(0, 0, 0, 0.12))',
				}}
			/>
			<div
				className='relative flex h-[188px] w-[345px] flex-col justify-end rounded-20 p-[27px]'
				style={{
					background: `linear-gradient(123deg, ${colors ? colors[0] : '#24242499'}, ${
						colors ? colors[1] : '#18181899'
					})`,
				}}
			>
				<h3 className='truncate text-[28px] font-semibold -tracking-3'>{app.name}</h3>
				<p className='text-16 line-clamp-2 -tracking-4 opacity-70'>{app.tagline}</p>
			</div>
		</Link>
	)
}
