export type WidgetType =
	| 'stat-with-buttons'
	| 'stat-with-progress'
	| 'two-up-stat-with-progress'
	| 'three-up'
	| 'four-up'
	| 'actions'
	| 'notifications'

// ------------------------------

type FourUpItem = {
	title: string
	icon: string
	value: string
	valueSub: string
}
export type FourUpWidget = {
	type: 'four-up'
	link?: string
	items: [FourUpItem, FourUpItem, FourUpItem, FourUpItem]
}

type ThreeUpItem = {
	icon: string
	title: string
	value: string
}
export type ThreeUpWidget = {
	type: 'three-up'
	link?: string
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
	link?: string
	items: [TwoUpStatWithProgressItem, TwoUpStatWithProgressItem]
}

export type StatWithProgressWidget = {
	type: 'stat-with-progress'
	link?: string
	title: string
	value: string
	valueSub?: string
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

// TODO: rename to ListWidget
export type NotificationsWidget = {
	type: 'notifications'
	link?: string
	notifications: {
		timestamp: number
		description: string
	}[]
}

export type ActionsWidget = {
	type: 'actions'
	link?: string
	count: number
	actions: {
		emoji: string
		title: string
	}[]
}

type AnyWidgetConfig =
	| FourUpWidget
	| ThreeUpWidget
	| TwoUpStatWithProgressWidget
	| StatWithProgressWidget
	| StatWithButtonsWidget
	| NotificationsWidget
	| ActionsWidget

// Choose the widget AnyWidgetConfig based on the type `T` passed in, othwerwise `never`
export type WidgetConfig<T extends WidgetType = WidgetType> = Extract<AnyWidgetConfig, {type: T}>

// ------------------------------

export type ExampleWidgetConfig<T extends WidgetType = WidgetType> = T extends 'stat-with-buttons'
	? // Omit the `type` (and `link` from buttons) by omitting `buttons` and then adding it without the `link`
	  Omit<StatWithButtonsWidget, 'type' | 'buttons'> & {buttons: Omit<StatWithButtonsWidget['buttons'], 'link'>}
	: // Otherwise, just omit the `type`
	  Omit<WidgetConfig<T>, 'type'>

// Adding `= WidgetType` to `T` makes it so that if `T` is not provided, it defaults to `WidgetType`. Prevents us from always having to write `RegistryWidget<WidgetType>` when referring to the type.
export type RegistryWidget<T extends WidgetType = WidgetType> = {
	id: string
	type: T
	refresh?: number
	// Examples aren't interactive so no need to include `link` in example
	example?: ExampleWidgetConfig<T>
	endpoint: string
}
