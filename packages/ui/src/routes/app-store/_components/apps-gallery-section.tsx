import {Link} from 'react-router-dom'

import {AppT} from '@/hooks/use-available-apps'

export const AppsGallerySection: React.FC<{apps: AppT[]}> = ({apps}) => {
	return (
		<div className='umbrel-fade-scroller-x umbrel-hide-scrollbar flex gap-5 overflow-x-auto'>
			{apps.slice(0, 3).map((app) => (
				<Link
					key={app.id}
					to={`/app-store/${app.id}`}
					className='h-[316px] w-[712px] shrink-0 rounded-10 bg-white/10 bg-cover'
					style={{
						backgroundImage: `url(${app.gallery[0]})`,
					}}
				/>
			))}
		</div>
	)
}
