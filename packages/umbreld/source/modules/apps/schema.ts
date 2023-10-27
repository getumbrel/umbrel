import type {categories} from './data'

export type AppRepositoryMeta = {
	id: string
	name: string
}

export type Category = typeof categories[number]

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
}
