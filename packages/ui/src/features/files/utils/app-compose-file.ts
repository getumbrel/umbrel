import {APPS_PATH} from '@/features/files/constants'

// umbrelOS writes these itself: docker-compose.umbreld.yml is rebuilt from the
// app's compose file on every start, docker-compose.umbrel-user-settings.yml
// from App Settings whenever they change
const GENERATED_COMPOSE_FILES: ReadonlySet<string> = new Set([
	'docker-compose.umbreld.yml',
	'docker-compose.umbrel-user-settings.yml',
])

export type AppComposeFile = {appId: string; generated: boolean}

// A compose file directly inside an app's folder (/Apps/<app-id>/docker-compose*.yml).
// Editing one by hand can break the app, and most of what people edit them
// for is available in App Settings.
export function getAppComposeFile(path: string): AppComposeFile | null {
	if (!path.startsWith(`${APPS_PATH}/`)) return null
	const segments = path.slice(APPS_PATH.length + 1).split('/')
	if (segments.length !== 2) return null
	const [appId, name] = segments
	if (!appId || !name.includes('docker-compose')) return null
	return {appId, generated: GENERATED_COMPOSE_FILES.has(name)}
}
