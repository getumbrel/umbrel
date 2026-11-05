import type Umbreld from '../../index.ts'
import {OWNER_USER_ID} from '../user/constants.ts'

const accountPrefix = (userId: string) => `@account:${encodeURIComponent(userId)}:`
const accountNotification = (userId: string, notification: string) => `${accountPrefix(userId)}${notification}`

export default class Notifications {
	#umbreld: Umbreld
	#store: Umbreld['store']
	logger: Umbreld['logger']

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		this.#store = umbreld.store
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
	}

	// Get the user object from the store
	async get() {
		return (await this.#store.get('notifications')) || []
	}

	// Device-level notifications remain visible to the owner. Account-scoped
	// notifications (currently Cloud) are visible only to the account that owns
	// them, including when that account is the device owner.
	async getForAccount(userId: string) {
		const notifications = await this.get()
		const prefix = accountPrefix(userId)
		return notifications.flatMap((notification) => {
			if (notification.startsWith(prefix)) return [notification.slice(prefix.length)]
			if (userId === OWNER_USER_ID && !notification.startsWith('@account:')) return [notification]
			return []
		})
	}

	async add(notification: string) {
		this.logger.log(`Adding notification: ${notification}`)
		await this.#store.getWriteLock(async ({set}) => {
			// Get all notifications
			let notifications = await this.get()

			// Remove current one if it already exists so it's
			// moved to the front
			notifications = notifications.filter((n) => n !== notification)

			// Add new notification
			notifications.unshift(notification)

			// Save new notifications
			await set('notifications', notifications)
		})

		// Wake up subscribed clients
		this.#umbreld.eventBus.emit('notifications:change')

		return true
	}

	async addForAccount(userId: string, notification: string) {
		return this.add(accountNotification(userId, notification))
	}

	async clear(notification: string) {
		this.logger.log(`Clearing notification: ${notification}`)
		await this.#store.getWriteLock(async ({set}) => {
			// Get all notifications
			let notifications = await this.get()

			// Remove current one if it already exists
			notifications = notifications.filter((n) => n !== notification)

			// Save new notifications
			await set('notifications', notifications)
		})

		// Wake up subscribed clients
		this.#umbreld.eventBus.emit('notifications:change')

		return true
	}

	async clearForAccount(userId: string, notification: string) {
		await this.clear(accountNotification(userId, notification))
		return true
	}

	// Clear only notifications visible under this account's presentation. The
	// owner also sees device-level notifications, while a member must never be
	// able to address an unscoped notification by guessing its id.
	async clearVisibleForAccount(userId: string, notification: string) {
		const scopedNotification = accountNotification(userId, notification)
		this.logger.log(`Clearing visible notification for account ${userId}: ${notification}`)
		await this.#store.getWriteLock(async ({set}) => {
			await set(
				'notifications',
				(await this.get()).filter(
					(stored) => stored !== scopedNotification && (userId !== OWNER_USER_ID || stored !== notification),
				),
			)
		})

		// Wake up subscribed clients
		this.#umbreld.eventBus.emit('notifications:change')

		return true
	}

	async clearAccount(userId: string) {
		const prefix = accountPrefix(userId)
		this.logger.log(`Clearing notifications for account: ${userId}`)
		await this.#store.getWriteLock(async ({set}) => {
			await set(
				'notifications',
				(await this.get()).filter((notification) => !notification.startsWith(prefix)),
			)
		})

		// Wake up subscribed clients
		this.#umbreld.eventBus.emit('notifications:change')

		return true
	}
}
