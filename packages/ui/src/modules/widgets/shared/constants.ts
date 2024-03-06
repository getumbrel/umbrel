// TODO: this should all probably be in umbreld

export type WidgetType =
	| 'stat-with-buttons'
	| 'stat-with-progress'
	| 'two-up-stat-with-progress'
	| 'three-up'
	| 'four-up'
	| 'list-emoji'
	| 'list'

// ------------------------------

/**
 * This link is relative to `RegistryApp['path']`
 * NOTE: type is created for this comment to appear in VSCode
 */
type Link = string

type FourUpItem = {
	title: string
	icon: string
	value: string
	valueSub: string
}
export type FourUpWidget = {
	type: 'four-up'
	link?: Link
	items: [FourUpItem, FourUpItem, FourUpItem, FourUpItem]
}

type ThreeUpItem = {
	icon: string
	title: string
	value: string
}
export type ThreeUpWidget = {
	type: 'three-up'
	link?: Link
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
	link?: Link
	items: [TwoUpStatWithProgressItem, TwoUpStatWithProgressItem]
}

export type StatWithProgressWidget = {
	type: 'stat-with-progress'
	link?: Link
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
		text: string
		icon: string
		link: Link
	}[]
}

export type ListWidget = {
	type: 'list'
	link?: Link
	items: {
		text: string
		textSub: string
	}[]
}

export type ListEmojiWidget = {
	type: 'list-emoji'
	link?: Link
	count: number
	items: {
		emoji: string
		text: string
	}[]
}

type AnyWidgetConfig =
	| FourUpWidget
	| ThreeUpWidget
	| TwoUpStatWithProgressWidget
	| StatWithProgressWidget
	| StatWithButtonsWidget
	| ListWidget
	| ListEmojiWidget

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
}

// ------------------------------

export const MAX_WIDGETS = 3

export const liveUsageWidgets: [
	RegistryWidget<'stat-with-progress'>,
	RegistryWidget<'stat-with-progress'>,
	RegistryWidget<'three-up'>,
] = [
	{
		id: 'umbrel:storage',
		type: 'stat-with-progress',
		example: {
			title: 'Storage',
			value: '256 GB',
			progressLabel: '1.75 TB left',
			progress: 0.25,
		},
	},
	{
		id: 'umbrel:memory',
		type: 'stat-with-progress',
		example: {
			title: 'Memory',
			value: '5.8 GB',
			valueSub: '/16GB',
			progressLabel: '11.4 GB left',
			progress: 0.36,
		},
	},
	{
		id: 'umbrel:system-stats',
		type: 'three-up',
		example: {
			items: [
				{
					icon: 'system-widget-cpu',
					title: 'CPU',
					value: '24%',
				},
				{
					icon: 'system-widget-storage',
					title: 'Free',
					value: '1.75 TB',
				},
				{
					icon: 'system-widget-memory',
					title: 'Memory',
					value: '5.8 GB',
				},
			],
		},
	},
]
