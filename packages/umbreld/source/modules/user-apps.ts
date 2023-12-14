import type Umbreld from '../index.js'

import {AppState, YamlApp} from './apps/schema.js'

// TODO: get install status from a real place
export let appStatuses: Record<string, {installProgress: number; state: AppState}> = {}
// TODO: this should be in the store
export let userAppsDemoStore: YamlApp[] = []

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

	async installApp(appId: string, registryId: string = 'umbrel-app-store') {
		// const apps = (await this.#store.get('user.apps')) ?? []
		const newAppEntry: YamlApp = {
			id: appId,
			registryId,
			showNotifications: true,
			autoUpdate: true,
			// if deterministic password is not set, we'll generate a random one
			showCredentialsBeforeOpen: true,
		}
		const appExists = userAppsDemoStore.find((app) => app.id === appId)
		if (appExists) {
			throw new Error('App already installed')
		}
		// const newApps = [...apps, newAppEntry]
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
		// const res = this.#store.set('user.apps', newApps)
		// return res
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
		// await this.#store.set(`user.apps.${appId}`, null)
		appStatuses[appId] = {
			state: 'uninstalling',
			installProgress: 100,
		}
		setTimeout(() => {
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
		// const apps = await this.#store.get('user.apps')
		// return apps ?? []
		return userAppsDemoStore
	}
}
