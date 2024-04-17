// TODO: this is used outside of the apps module, move it somewhere more appropriate
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

// TODO: just added this to quickly get types, come back to this and
// add strciter validation. We might also want to describe this with
// zod so we can do runtime valdiation with useful errors like tagline
// max length etc.
export type AppManifest = {
	manifestVersion: number
	id: string
	disabled?: boolean
	name: string
	tagline: string
	icon: string
	category: string
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
	/** In bytes */
	installSize?: number
	widgets?: any[] // TODO: Define this type
	defaultShell?: string
}
