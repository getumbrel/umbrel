import {Link} from 'react-router-dom'

import {cn} from '@/shadcn-lib/utils'
import {RegistryApp} from '@/trpc/trpc'
import {tw} from '@/utils/tw'

export const AppsGallerySection: React.FC<{apps: RegistryApp[]}> = ({apps}) => {
	return (
		<div className={galleryRootClass}>
			{apps.slice(0, 3).map((app) => (
				<Link
					key={app.id}
					to={`/app-store/${app.id}`}
					className={cn(galleryItemClass, 'h-[316px] w-[712px]')}
					style={{
						backgroundImage: `url(${app.gallery[0]})`,
					}}
				/>
			))}
		</div>
	)
}

export const AppGallerySection: React.FC<{gallery: string[]}> = ({gallery}) => {
	return (
		<div className={galleryRootClass}>
			{gallery.map((src) => (
				<button
					key={src}
					className={cn(galleryItemClass, 'h-[292px] w-[468px]')}
					style={{
						backgroundImage: `url(${src})`,
					}}
				/>
			))}
		</div>
	)
}

export const galleryRootClass = tw`umbrel-fade-scroller-x umbrel-hide-scrollbar flex gap-5 overflow-x-auto`

export const galleryItemClass = tw`shrink-0 rounded-10 bg-white/10 bg-cover outline-none ring-inset focus-visible:ring-4 ring-white/80`
