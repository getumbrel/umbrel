import type {WidgetType} from './schema.js'

// TODO: turn these into zod schema objects to use in the `preview` field in `schema.ts`

type FourUpItem = {
	title: string
	icon: string
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

// NOTE:
// The long name feels like it could be just be two-up, but this two-up widget is
// different from the others because it also has a progress. If we ever add one without a progress,
// that one would be two-up.
type TwoUpStatWithProgressItem = {
	title: string
	value: string
	valueSub: string
	/** Number from 0 to 1 */
	progress: number
}
export type TwoUpStatWithProgressWidget = {
	type: 'two-up-stat-with-progress'
	link: string
	items: [TwoUpStatWithProgressItem, TwoUpStatWithProgressItem]
}

export type StatWithProgressWidget = {
	type: 'stat-with-progress'
	link: string
	title: string
	value: string
	progressLabel: string
	/** Number from 0 to 1 */
	progress: number
}

export type StatWithButtonsWidget = {
	type: 'stat-with-buttons'
	icon: string
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
	| TwoUpStatWithProgressWidget
	| StatWithProgressWidget
	| StatWithButtonsWidget
	| NotificationsWidget
	| ActionsWidget

export type WidgetConfig<T> = T extends WidgetType ? Extract<AnyWidgetConfig, {type: T}> : never
