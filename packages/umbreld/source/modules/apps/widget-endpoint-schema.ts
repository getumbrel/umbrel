import type {WidgetType} from './schema.js'

type FourUpItem = {
	title: string
	value: string
	valueSub: string
}
export type FourUpWidget = {
	type: 'four-up'
	link: string
	items: [FourUpItem, FourUpItem, FourUpItem, FourUpItem]
}

type ThreeUpItem = {
	icon: string
	title: string
	value: string
}
export type ThreeUpWidget = {
	type: 'three-up'
	link: string
	items: [ThreeUpItem, ThreeUpItem, ThreeUpItem]
}

export type StatWithProgressWidget = {
	type: 'stat-with-progress'
	link: string
	title: string
	value: string
	progressLabel: string
	progress: number
}

export type StatWithButtonsWidget = {
	type: 'stat-with-buttons'
	title: string
	value: string
	valueSub: string
	buttons: {
		title: string
		icon: string
		link: string
	}[]
}

export type NotificationsWidget = {
	type: 'notifications'
	link: string
	notifications: {
		timestamp: number
		description: string
	}[]
}

export type ActionsWidget = {
	type: 'actions'
	link: string
	count: number
	actions: {
		emoji: string
		title: string
	}[]
}

export type AnyWidgetConfig =
	| FourUpWidget
	| ThreeUpWidget
	| StatWithProgressWidget
	| StatWithButtonsWidget
	| NotificationsWidget
	| ActionsWidget

export type WidgetConfig<T> = T extends WidgetType ? Extract<AnyWidgetConfig, {type: T}> : never
