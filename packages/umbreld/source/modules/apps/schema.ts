import {z} from 'zod'
import semver from 'semver'

import {NativeTlsHostnameSuffixesSchema} from './native-tls.js'

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

export const AppManifestFolderAccessMountSchema = z.object({
	service: z.string().optional(),
	targetPath: z.string(),
	readOnly: z.boolean().optional(),
})

export const APP_MANIFEST_FOLDER_ACCESS_NOTE_MAX_LENGTH = 300
export const APP_MANIFEST_ENVIRONMENT_NOTE_MAX_LENGTH = 300

const AppManifestEnvironmentOptionSchema = z.preprocess(
	(value) =>
		typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : value,
	z.string().min(1),
)

export const AppManifestFolderAccessSchema = z.object({
	id: z.string(),
	name: z.string(),
	note: z
		.string()
		.trim()
		.transform((note) =>
			!note
				? undefined
				: note.length > APP_MANIFEST_FOLDER_ACCESS_NOTE_MAX_LENGTH
					? `${note.slice(0, APP_MANIFEST_FOLDER_ACCESS_NOTE_MAX_LENGTH - 1).trimEnd()}…`
					: note,
		)
		.optional(),
	mounts: z.array(AppManifestFolderAccessMountSchema).min(1),
})

// Defaults are UI-only placeholders and never change runtime behaviour unless
// the user saves an override. A present default is coerced to a string since
// YAML parses unquoted values like `1000` or `true` as non-strings, while an
// absent or null default stays undefined (rather than the string "null").
export const AppManifestEnvironmentVariableSchema = z.object({
	name: z.string(),
	services: z.array(z.string()).min(1),
	default: z.preprocess(
		(value) => (value === null || value === undefined ? undefined : String(value)),
		z.string().optional(),
	),
	options: z
		.array(AppManifestEnvironmentOptionSchema)
		.min(1)
		.refine((options) => new Set(options).size === options.length, {message: 'environment options must be unique'})
		.optional(),
	note: z
		.string()
		.trim()
		.transform((note) =>
			!note
				? undefined
				: note.length > APP_MANIFEST_ENVIRONMENT_NOTE_MAX_LENGTH
					? `${note.slice(0, APP_MANIFEST_ENVIRONMENT_NOTE_MAX_LENGTH - 1).trimEnd()}…`
					: note,
		)
		.optional(),
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
	requiresHttps: z.boolean().optional(),
	nativeTlsHostnameSuffixes: NativeTlsHostnameSuffixesSchema.optional(),
	// In bytes
	installSize: z.number().int().optional(),
	// TODO: Define this type
	widgets: z.array(z.any()).optional(),
	defaultShell: z.string().optional(),
	implements: z.array(z.string()).optional(),
	backupIgnore: z.array(z.string()).optional(),
	// App Compose files keep using APP_DATA_DIR/data for backwards compatibility.
	// This declaration lets supported umbrelOS versions redirect that complete root.
	storage: z
		.object({
			dataRoot: z.literal('data'),
		})
		.optional(),
	folderAccess: z.array(AppManifestFolderAccessSchema).optional(),
	environment: z.array(AppManifestEnvironmentVariableSchema).optional(),
})

export type AppManifest = z.infer<typeof AppManifestSchema>
export type AppManifestFolderAccess = z.infer<typeof AppManifestFolderAccessSchema>
export type AppManifestEnvironmentVariable = z.infer<typeof AppManifestEnvironmentVariableSchema>

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
	if (parsed.storage !== undefined) {
		const storage = z
			.object({dataRoot: z.literal('data')})
			.strict()
			.safeParse(parsed.storage)
		if (!storage.success) throw new Error('invalid manifest storage')
	}

	// TODO (apps refactor): switch to semantic versions?
	// parsed.version = tryNormalizeVersion(parsed.version)

	// TODO (apps refactor): enable schema validation
	// return AppManifestSchema.parse(parsed)

	return parsed as AppManifest
}

export const AppCustomMountSchema = z.object({
	serviceName: z.string(),
	targetPath: z.string(),
	sourcePath: z.string(),
	readOnly: z.boolean(),
})

export const AppFolderAccessSelectionSchema = z.object({
	id: z.string(),
	sourcePath: z.string(),
})

export const AppDataRootLocationSchema = z.object({
	path: z.string(),
	filesystemUuid: z.string().optional(),
	host: z.string().optional(),
	share: z.string().optional(),
})

export const AppDataRootMoveSchema = z.object({
	source: AppDataRootLocationSchema.nullable(),
	destination: AppDataRootLocationSchema.nullable(),
	token: z.string().uuid(),
})

export const AppEnvironmentVariableSchema = z.object({
	name: z.string(),
	value: z.string(),
})

export const AppCustomEnvironmentVariableSchema = z.object({
	serviceName: z.string(),
	name: z.string(),
	value: z.string(),
})

export const AppSettingsSchema = z.object({
	hideCredentialsBeforeOpen: z.boolean().optional(),
	dependencies: z.record(z.string()).optional(),
	backupIgnore: z.boolean().optional(),
	autoStart: z.boolean().optional(),
	appProxyAuthEnabled: z.boolean().optional(),
	dataRootLocation: AppDataRootLocationSchema.optional(),
	dataRootMove: AppDataRootMoveSchema.optional(),
	dataRootResetPending: z.boolean().optional(),
	customMounts: z.array(AppCustomMountSchema).optional(),
	folderAccess: z.array(AppFolderAccessSelectionSchema).optional(),
	environment: z.array(AppEnvironmentVariableSchema).optional(),
	customEnvironment: z.array(AppCustomEnvironmentVariableSchema).optional(),
})

export type AppSettings = z.infer<typeof AppSettingsSchema>
export type AppDataRootLocation = z.infer<typeof AppDataRootLocationSchema>
export type AppDataRootMove = z.infer<typeof AppDataRootMoveSchema>
export type AppCustomMount = NonNullable<AppSettings['customMounts']>[number]
export type AppFolderAccessSelection = z.infer<typeof AppFolderAccessSelectionSchema>
export type AppEnvironmentVariable = z.infer<typeof AppEnvironmentVariableSchema>
export type AppCustomEnvironmentVariable = z.infer<typeof AppCustomEnvironmentVariableSchema>
