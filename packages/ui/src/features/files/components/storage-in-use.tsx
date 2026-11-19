import type {TFunction} from 'i18next'
import {TbAlertTriangle} from 'react-icons/tb'

import {AppIcon} from '@/components/app-icon'
import {FadeScroller} from '@/components/fade-scroller'
import {StorageLocation} from '@/features/files/components/storage-location'
import {getAppStorageSourcePaths} from '@/modules/apps/app-storage'
import type {ConfirmationOptions, ConfirmationResult} from '@/providers/confirmation'
import type {RouterOutput, UserApp} from '@/trpc/trpc'

type AppsListOutput = RouterOutput['apps']['list']
type StorageInUseApp = Pick<UserApp, 'id' | 'name' | 'icon'>

// Client-side twin of the backend's getAppsUsingStorageSource() guard: active
// apps with a storage folder at or under any of the given paths. Derived from
// the cached apps list purely for display, the backend guard stays the
// authority on whether removal is actually blocked.
export function getActiveAppsUsingStoragePaths(apps: AppsListOutput | undefined, paths: string[]): UserApp[] {
	const userApps = (apps ?? []).filter((app): app is UserApp => !('error' in app))
	const appsById = new Map(userApps.map((app) => [app.id, app]))
	const getDataRootPaths = (app: UserApp, visited = new Set<string>()): string[] => {
		if (visited.has(app.id)) return []
		visited.add(app.id)
		return [
			...(app.storage?.dataRoot?.location ? [app.storage.dataRoot.location] : []),
			...Object.values(app.selectedDependencies ?? {}).flatMap((dependencyId) => {
				const dependency = appsById.get(dependencyId)
				return dependency ? getDataRootPaths(dependency, visited) : []
			}),
		]
	}

	return userApps.filter((app) => {
		if (app.state === 'stopped') return false
		// Data roots come from getDataRootPaths so inherited dependency storage
		// counts too; the shared helper adds the app's own folders and mounts
		const sources = [...getDataRootPaths(app), ...getAppStorageSourcePaths(app, {includeDataRoot: false})]
		return sources.some((source) => paths.some((path) => source === path || source.startsWith(`${path}/`)))
	})
}

// Show the blocked-removal dialog: why removal is blocked, and the apps using
// the storage listed with icons so the user knows what to stop.
export async function showStorageInUseDialog({
	confirm,
	t,
	title,
	description,
	fallbackMessage,
	storagePath,
	storageName,
	apps,
}: {
	confirm: (options: ConfirmationOptions) => Promise<ConfirmationResult>
	t: TFunction
	title: string
	description: string
	// Shown alone when the cached apps list can't identify the blocking apps
	fallbackMessage: string
	storagePath?: string
	storageName?: string
	apps: StorageInUseApp[]
}): Promise<void> {
	const message =
		apps.length === 0 ? (
			fallbackMessage
		) : (
			<div className='space-y-3 text-left'>
				{storagePath ? (
					<div className='flex justify-center rounded-12 bg-white/5 px-3 py-2.5'>
						<StorageLocation
							path={storagePath}
							name={storageName}
							className='text-14 font-medium text-white/80'
							iconClassName='size-7'
						/>
					</div>
				) : null}
				<p>{description}</p>
				{/* Same row treatment as AppWithName in uninstall-these-first-dialog.tsx */}
				<FadeScroller direction='y' className='umbrel-hide-scrollbar max-h-[196px] space-y-3 overflow-y-auto'>
					{apps.map((app) => (
						<div key={app.id} className='flex w-full items-center gap-2.5'>
							<AppIcon src={app.icon} size={36} className='rounded-8' />
							<h3 className='truncate text-14 leading-tight font-semibold -tracking-3'>{app.name}</h3>
						</div>
					))}
				</FadeScroller>
			</div>
		)

	await confirm({
		title,
		message,
		actions: [{label: t('ok'), value: 'ok', variant: 'primary'}],
		icon: TbAlertTriangle,
	}).catch(() => {
		// Dismissed
	})
}
