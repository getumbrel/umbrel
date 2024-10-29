// TODO: this should all probably be in umbreld

export const DEFAULT_REFRESH_MS = 1000 * 60 * 5

type BaseWidget = {
	refresh?: number
}

export const widgetTypes = [
	'text-with-buttons',
	'text-with-progress',
	'two-stats-with-guage',
	'three-stats',
	'four-stats',
	'list-emoji',
	'list',
] as const

export type WidgetType = (typeof widgetTypes)[number]

// ------------------------------

/**
 * This link is relative to `RegistryApp['path']`
 * NOTE: type is created for this comment to appear in VSCode
 */
type Link = string

export type FourStatsItem = BaseWidget & {
	title?: string
	text?: string
	subtext?: string
}
export type FourStatsWidget = BaseWidget & {
	type: 'four-stats'
	link?: Link
	items?: [FourStatsItem, FourStatsItem, FourStatsItem, FourStatsItem]
}
export type FourStatsWidgetProps = Omit<FourStatsWidget, 'type'>

export type ThreeStatsItem = {
	icon?: string
	subtext?: string
	text?: string
}
export type ThreeStatsWidget = BaseWidget & {
	type: 'three-stats'
	link?: Link
	items?: [ThreeStatsItem, ThreeStatsItem, ThreeStatsItem]
}
export type ThreeStatsWidgetProps = Omit<ThreeStatsWidget, 'type'>

// The long name feels like it could be just be two-stats, but if we ever add one without a progress, what would we call it?
export type TwoStatsWithProgressItem = {
	title?: string
	text?: string
	subtext?: string
	/** Number from 0 to 1 */
	progress?: number
}
export type TwoStatsWithProgressWidget = BaseWidget & {
	type: 'two-stats-with-guage'
	link?: Link
	items?: [TwoStatsWithProgressItem, TwoStatsWithProgressItem]
}
export type TwoStatsWithProgressWidgetProps = Omit<TwoStatsWithProgressWidget, 'type'>

export type TextWithProgressWidget = BaseWidget & {
	type: 'text-with-progress'
	link?: Link
	title?: string
	text?: string
	subtext?: string
	progressLabel?: string
	/** Number from 0 to 1 */
	progress?: number
}
export type TextWithProgressWidgetProps = Omit<TextWithProgressWidget, 'type'>

export type TextWithButtonsWidget = BaseWidget & {
	type: 'text-with-buttons'
	title?: string
	text?: string
	subtext?: string
	buttons?: {
		text?: string
		icon?: string
		link: Link
	}[]
}
export type TextWithButtonsWidgetProps = Omit<TextWithButtonsWidget, 'type'>

export type ListWidgetItem = {
	text?: string
	subtext?: string
}
export type ListWidget = BaseWidget & {
	type: 'list'
	link?: Link
	items?: ListWidgetItem[]
	noItemsText?: string
}
export type ListWidgetProps = Omit<ListWidget, 'type'>

export type ListEmojiItem = {
	emoji?: string
	text?: string
}
export type ListEmojiWidget = BaseWidget & {
	type: 'list-emoji'
	link?: Link
	count?: string
	items?: ListEmojiItem[]
}
export type ListEmojiWidgetProps = Omit<ListEmojiWidget, 'type'>

type AnyWidgetConfig =
	| FourStatsWidget
	| ThreeStatsWidget
	| TwoStatsWithProgressWidget
	| TextWithProgressWidget
	| TextWithButtonsWidget
	| ListWidget
	| ListEmojiWidget

// Choose the widget AnyWidgetConfig based on the type `T` passed in, othwerwise `never`
export type WidgetConfig<T extends WidgetType = WidgetType> = Extract<AnyWidgetConfig, {type: T}>

// ------------------------------

export type ExampleWidgetConfig<T extends WidgetType = WidgetType> = T extends 'text-with-buttons'
	? // Omit the `type` (and `link` from buttons) by omitting `buttons` and then adding it without the `link`
		Omit<TextWithButtonsWidget, 'type' | 'buttons'> & {buttons: Omit<TextWithButtonsWidget['buttons'], 'link'>}
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
	RegistryWidget<'text-with-progress'>,
	RegistryWidget<'text-with-progress'>,
	RegistryWidget<'three-stats'>,
] = [
	{
		id: 'umbrel:storage',
		type: 'text-with-progress',
		example: {
			title: 'Storage',
			text: '256 GB',
			progressLabel: '1.75 TB left',
			progress: 0.25,
		},
	},
	{
		id: 'umbrel:memory',
		type: 'text-with-progress',
		example: {
			title: 'Memory',
			text: '5.8 GB',
			subtext: '/16GB',
			progressLabel: '11.4 GB left',
			progress: 0.36,
		},
	},
	{
		id: 'umbrel:system-stats',
		type: 'three-stats',
		example: {
			items: [
				{
					icon: 'system-widget-cpu',
					subtext: 'CPU',
					text: '24%',
				},
				{
					icon: 'system-widget-memory',
					subtext: 'Memory',
					text: '5.8 GB',
				},
				{
					icon: 'system-widget-storage',
					subtext: 'Storage',
					text: '1.75 TB',
				},
			],
		},
	},
]
