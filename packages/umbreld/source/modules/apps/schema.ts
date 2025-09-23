import {z} from 'zod'
import semver from 'semver'

// TODO: this is used outside of the apps module, move it somewhere more appropriate
export type ProgressStatus = {
	running: boolean
	/** From 0 to 100 */
	progress: number
	description: string
	error: boolean | string
}

export const AppRepositoryMetaSchema = z.object({
	id: z.string(),
	name: z.string(),
})

export type AppRepositoryMeta = z.infer<typeof AppRepositoryMetaSchema>

const validateSemanticVersion = z.string().refine(semver.valid, {
	message: 'invalid semantic version',
})

// We might want to describe this further so we can do runtime valdiation with
// useful errors like tagline max length etc.
export const AppManifestSchema = z.object({
	manifestVersion: validateSemanticVersion,
	id: z.string(),
	disabled: z.boolean().optional(),
	name: z.string(),
	tagline: z.string(),
	icon: z.string().optional(),
	category: z.string(),
	// TODO (apps refactor): switch to semantic versions?
	version: z.string(),
	port: z.number().int(),
	description: z.string(),
	website: z.string().url(),
	// TODO: one developer/submitter is an integer
	developer: z.union([z.string(), z.number()]).optional(),
	submitter: z.union([z.string(), z.number()]).optional(),
	submission: z.string().url().optional(),
	// TODO: some apps have an empty repo string
	repo: z.union([z.string().url(), z.string().length(0)]).optional(),
	support: z.string(),
	gallery: z.array(z.string()),
	releaseNotes: z.string().optional(),
	dependencies: z.array(z.string()).optional(),
	permissions: z.array(z.string()).optional(),
	path: z.string().optional(),
	defaultUsername: z.string().optional(),
	defaultPassword: z.string().optional(),
	deterministicPassword: z.boolean().optional(),
	optimizedForUmbrelHome: z.boolean().optional(),
	torOnly: z.boolean().optional(),
	// In bytes
	installSize: z.number().int().optional(),
	// TODO: Define this type
	widgets: z.array(z.any()).optional(),
	defaultShell: z.string().optional(),
	implements: z.array(z.string()).optional(),
	backupIgnore: z.array(z.string()).optional(),
})

export type AppManifest = z.infer<typeof AppManifestSchema>

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tryNormalizeVersion(version: number | string) {
	// Convert versions parsed as a number, e.g. `1` or `1.2`
	if (typeof version === 'number') {
		version = String(version)
	}
	// Retain valid version
	if (semver.valid(version)) {
		return version
	}
	// Otherwise try to coerce, e.g. 1 to 1.0.0
	const coerced = semver.coerce(version)
	return coerced ? coerced.toString() : version
}

export function validateManifest(parsed: unknown): AppManifest {
	if (!isRecord(parsed)) {
		throw new Error('invalid manifest')
	}
	parsed.manifestVersion = tryNormalizeVersion(parsed.manifestVersion)

	// TODO (apps refactor): switch to semantic versions?
	// parsed.version = tryNormalizeVersion(parsed.version)

	// TODO (apps refactor): enable schema validation
	// return AppManifestSchema.parse(parsed)

	return parsed as AppManifest
}

export const AppSettingsSchema = z.object({
	hideCredentialsBeforeOpen: z.boolean().optional(),
	dependencies: z.record(z.string()).optional(),
	backupIgnore: z.boolean().optional(),
})

export type AppSettings = z.infer<typeof AppSettingsSchema>
