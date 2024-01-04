import {z} from 'zod'
import type {categories} from './data'

export type ProgressStatus = {
	running: boolean
	/** From 0 to 100 */
	progress: number
	description: string
	error: boolean | string
}

export type AppRepositoryMeta = {
	id: string
	name: string
}

export type Category = typeof categories[number]

export const widgetSchema = z.object({
	type: z.enum(['stat-with-progress', 'stat-with-buttons', 'three-up', 'four-up', 'actions', 'notifications']),
	endpoint: z.string(),
})

export type Widget = z.infer<typeof widgetSchema>
export type WidgetType = Widget['type']

// TODO: just added this to quickly get types, come back to this and
// add strciter validation. We might also want to describe this with
// zod so we can do runtime valdiation with useful errors like tagline
// max length etc.
export type AppManifest = {
	manifestVersion: number
	id: string
	name: string
	tagline: string
	icon: string
	category: Category
	version: string
	port: number
	description: string
	developer: string
	website: string
	submitter: string
	submission: string
	repo?: string
	support: string
	gallery: string[]
	releaseNotes?: string
	dependencies?: string[]
	permissions?: string[]
	path?: string
	defaultUsername?: string
	defaultPassword?: string
	deterministicPassword?: boolean
	optimizedForUmbrelHome?: boolean
	torOnly?: boolean
	// TODO: add install size to API response for apps that have it
	installSize?: number
	widgets?: Widget[]
}

/** There's a 'ready' state instead of an 'installed' state because if an app is installed but updating, we don't want the user to do anything with that app. If an app is a UserApp (initiated install) */
export type AppState = 'ready' | 'offline' | 'installing' | 'uninstalling' | 'updating'

/**
 * App to store in yaml.
 * Stuff that can be retrieved from the app repository is not stored here.
 */
export type YamlApp = Pick<AppManifest, 'id'> & {
	registryId: string
	showNotifications: boolean
	autoUpdate: boolean
	// Should always be true unless set to `false`
	// If no deterministic password, we don't show this
	showCredentialsBeforeOpen: boolean
}

/**
 * App to return to frontend after installing.
 * Usually pull stuff from app repository for names, etc
 */
export type UserApp = YamlApp &
	Pick<AppManifest, 'name' | 'icon' | 'port'> & {
		credentials: {
			defaultUsername: string
			defaultPassword: string
		}
		// ---
		state: AppState
		// TODO: if state is installing, this should be 0-100, otherwise undefined
		/** From 0 to 100 */
		installProgress?: number
	}
