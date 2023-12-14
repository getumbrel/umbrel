import type Umbreld from '../index.js'
import type {AppState, YamlApp} from './apps/schema.js'

// TODO: Get install status from a real place
// Ignoring because it's demo code
// eslint-disable-next-line import/no-mutable-exports
export let appStatuses: Record<string, {installProgress: number; state: AppState}> = {}
// TODO: This should be in the store
let userAppsDemoStore: YamlApp[] = []

export default class UserApps {
	#store: Umbreld['store']

	constructor(umbreld: Umbreld) {
		this.#store = umbreld.store
	}

	// Tracks the user's last opened app
	async trackAppOpen(appId: string) {
		const apps = (await this.#store.get('user.lastOpenedApps')) ?? []
		const newApps = [appId, ...apps].slice(0, 50)
		return this.#store.set('user.lastOpenedApps', newApps)
	}

	async installApp(appId: string, registryId = 'umbrel-app-store') {
		const newAppEntry: YamlApp = {
			id: appId,
			registryId,
			showNotifications: true,
			autoUpdate: true,
			// If deterministic password is not set, we'll generate a random one
			showCredentialsBeforeOpen: true,
		}
		const appExists = userAppsDemoStore.find((app) => app.id === appId)
		if (appExists) {
			throw new Error('App already installed')
		}

		appStatuses[appId] = {
			state: 'installing',
			installProgress: 0,
		}
		const interval = setInterval(() => {
			console.log('installing app', appId, appStatuses[appId].installProgress)
			appStatuses[appId].installProgress += Math.round(Math.random() * 10)
			if (appStatuses[appId].installProgress >= 100) {
				appStatuses[appId].installProgress = 100
				appStatuses[appId].state = 'ready'
				clearInterval(interval)
			}
		}, 200)
		userAppsDemoStore.push(newAppEntry)
		return newAppEntry
	}

	// TODO: make this into a subscription
	async getInstallStatus(appId: string) {
		console.log(appStatuses)
		return (
			appStatuses[appId] ?? {
				state: 'uninstalled',
				installProgress: 0,
			}
		)
	}

	async uninstallApp(appId: string) {
		appStatuses[appId] = {
			state: 'uninstalling',
			installProgress: 100,
		}
		setTimeout(() => {
			// Ignoring because it's demo code
			// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
			delete appStatuses[appId]
			userAppsDemoStore = userAppsDemoStore.filter((app) => app.id !== appId)
		}, 1000)
		// TODO: Remove from last opened apps
		return true
	}

	async uninstallAll() {
		appStatuses = {}
		userAppsDemoStore = []
		return true
	}

	async restart(appId: string) {
		appStatuses[appId] = {
			...appStatuses[appId],
			state: 'offline',
		}
		setTimeout(() => {
			appStatuses[appId] = {
				...appStatuses[appId],
				state: 'ready',
			}
		}, 1000)
	}

	async update(appId: string) {
		appStatuses[appId] = {
			...appStatuses[appId],
			state: 'updating',
		}
		setTimeout(() => {
			appStatuses[appId] = {
				...appStatuses[appId],
				state: 'ready',
			}
		}, 1000)
	}

	async updateAll() {}

	async getApps() {
		return userAppsDemoStore
	}
}
