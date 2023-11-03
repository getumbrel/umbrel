import {Link} from 'react-router-dom'

import {Banner} from '@/routes/app-store/use-discover-query'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

export const AppsGallerySection: React.FC<{banners: Banner[]}> = ({banners}) => {
	return (
		<div className={galleryRootClass}>
			{banners.map((banner, i) => (
				<Link
					key={banner.id}
					to={`/app-store/${banner.id}`}
					className={cn(galleryItemClass, 'h-[316px] w-[712px]')}
					style={{
						backgroundImage: `url(${banner.image})`,
						animationDelay: `${i * 0.1}s`,
					}}
				/>
			))}
		</div>
	)
}

export const AppGallerySection: React.FC<{gallery: string[]}> = ({gallery}) => {
	return (
		<div className={galleryRootClass}>
			{gallery.map((src, i) => (
				<button
					key={src}
					className={cn(galleryItemClass, 'h-[292px] w-[468px]')}
					style={{
						backgroundImage: `url(${src})`,
						animationDelay: `${i * 0.1}s`,
					}}
				/>
			))}
		</div>
	)
}

export const galleryRootClass = tw`umbrel-fade-scroller-x umbrel-hide-scrollbar flex gap-5 overflow-x-auto`

export const galleryItemClass = tw`shrink-0 rounded-10 bg-white/10 bg-cover outline-none ring-inset focus-visible:ring-4 ring-white/80 animate-in fade-in fill-mode-both slide-in-from-right-10`