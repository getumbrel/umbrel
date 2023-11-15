import {RegistryApp} from '@/trpc/trpc'
import {preloadImage} from '@/utils/misc'

export function preloadFirstFewGalleryImages(app: RegistryApp) {
	return app.gallery.slice(0, 3).map(preloadImage)
}
