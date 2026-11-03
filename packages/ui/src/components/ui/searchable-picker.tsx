import * as PopoverPrimitive from '@radix-ui/react-popover'
import {Check, Search, X} from 'lucide-react'
import {matchSorter} from 'match-sorter'
import {useEffect, useId, useRef, useState, type ReactNode} from 'react'
import {useTranslation} from 'react-i18next'

import {useFadeScroller} from '@/components/fade-scroller'
import {cn} from '@/lib/utils'

import {floatingContentAnimationClass, materialSurfaceClasses} from './shared/material'

export type SearchablePickerItem = {
	value: string
	label: string
	keywords?: string[]
	icon?: ReactNode
	// The item's language when it isn't the UI's, such as a language's own name
	lang?: string
}

type Props = {
	children: ReactNode
	items: SearchablePickerItem[]
	value?: string
	onSelect: (value: string) => void
	placeholder: string
	emptyLabel?: string
	loading?: boolean
	open?: boolean
	onOpenChange?: (open: boolean) => void
	align?: 'start' | 'center' | 'end'
	className?: string
}

/** A searchable choice list. The input keeps focus while the active option moves;
 * the checkmark and aria-selected describe the saved choice, not the hover state. */
export function SearchablePicker({
	children,
	items,
	value,
	onSelect,
	placeholder,
	emptyLabel,
	loading = false,
	open: controlledOpen,
	onOpenChange,
	align = 'end',
	className,
}: Props) {
	const {t} = useTranslation()
	const [internalOpen, setInternalOpen] = useState(false)
	const open = controlledOpen ?? internalOpen
	const [query, setQuery] = useState('')
	const [activeValue, setActiveValue] = useState<string>()
	const inputRef = useRef<HTMLInputElement>(null)
	const listId = useId()
	const optionId = (itemValue: string) => `${listId}-${encodeURIComponent(itemValue)}`
	const results = loading
		? []
		: query.trim()
			? matchSorter(items, query.trim(), {
					keys: ['label', 'value', 'keywords'],
					threshold: matchSorter.rankings.WORD_STARTS_WITH,
				})
			: items
	const activeItem =
		results.find((item) => item.value === activeValue) ??
		(query ? undefined : results.find((item) => item.value === value)) ??
		results[0]

	const changeOpen = (next: boolean) => {
		setInternalOpen(next)
		setQuery('')
		setActiveValue(undefined)
		onOpenChange?.(next)
	}
	const select = (itemValue: string) => {
		onSelect(itemValue)
		changeOpen(false)
	}

	return (
		// The portal sits outside any parent dialog's scroll boundary. A modal
		// popover gives it its own boundary so wheel/touch can scroll the list.
		<PopoverPrimitive.Root modal open={open} onOpenChange={changeOpen}>
			<PopoverPrimitive.Trigger asChild onClick={(event) => event.stopPropagation()}>
				{children}
			</PopoverPrimitive.Trigger>
			<PopoverPrimitive.Portal>
				<PopoverPrimitive.Content
					align={align}
					sideOffset={4}
					collisionPadding={8}
					aria-label={placeholder}
					onClick={(event) => event.stopPropagation()}
					onOpenAutoFocus={(event) => {
						event.preventDefault()
						setQuery('')
						setActiveValue(undefined)
						inputRef.current?.focus()
					}}
					onEscapeKeyDown={(event) => {
						if (event.isComposing || event.keyCode === 229) event.preventDefault()
					}}
					className={cn(
						materialSurfaceClasses.dropdown,
						floatingContentAnimationClass,
						'z-50 flex max-h-[min(320px,var(--radix-popover-content-available-height))] w-64 max-w-[calc(100vw-16px)] flex-col gap-1.5 overflow-hidden p-1 text-white outline-hidden',
						'[--picker-inner-radius:calc(var(--material-dropdown-radius)-4px-var(--material-border-width))]',
						className,
					)}
				>
					<div className='flex h-9 shrink-0 items-center gap-2 rounded-[var(--picker-inner-radius)] bg-white/6 px-3 shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.08)] transition-colors focus-within:bg-white/8 focus-within:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.20)]'>
						<Search className='size-3.5 shrink-0 text-white/40' aria-hidden='true' />
						<input
							ref={inputRef}
							role='combobox'
							aria-label={placeholder}
							aria-expanded={open}
							aria-autocomplete='list'
							aria-controls={listId}
							aria-activedescendant={activeItem ? optionId(activeItem.value) : undefined}
							value={query}
							placeholder={placeholder}
							autoComplete='off'
							spellCheck={false}
							className='h-full min-w-0 flex-1 bg-transparent text-14 font-normal -tracking-2 text-white/90 outline-hidden placeholder:text-white/40'
							onChange={(event) => {
								setQuery(event.target.value)
								setActiveValue(undefined)
							}}
							onKeyDown={(event) => {
								event.stopPropagation()
								if (event.nativeEvent.isComposing || event.keyCode === 229) return
								if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
									event.preventDefault()
									if (!results.length) return
									const index = results.findIndex((item) => item.value === activeItem?.value)
									const step = event.key === 'ArrowDown' ? 1 : -1
									setActiveValue(results[(index + step + results.length) % results.length].value)
								} else if (event.key === 'Enter') {
									event.preventDefault()
									if (activeItem) select(activeItem.value)
								} else if (event.key === 'Escape') {
									event.preventDefault()
									changeOpen(false)
								}
							}}
						/>
						{query && (
							<button
								type='button'
								aria-label={t('cmdk.clear-search')}
								className='-mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-white/40 outline-hidden hover:bg-white/10 hover:text-white/80 focus-visible:ring-2 focus-visible:ring-ring'
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => {
									setQuery('')
									setActiveValue(undefined)
									inputRef.current?.focus()
								}}
							>
								<X className='size-3.5' aria-hidden='true' />
							</button>
						)}
					</div>
					<PickerOptions
						id={listId}
						label={placeholder}
						items={results}
						value={value}
						activeValue={activeItem?.value}
						optionId={optionId}
						onActiveChange={setActiveValue}
						onSelect={select}
						loading={loading}
					/>
					{results.length === 0 && (
						<div role='status' className='px-3 py-4 text-center text-13 leading-relaxed text-white/50'>
							{loading
								? t('loading')
								: items.length === 0
									? (emptyLabel ?? t('no-results-found'))
									: t('no-results-found')}
						</div>
					)}
				</PopoverPrimitive.Content>
			</PopoverPrimitive.Portal>
		</PopoverPrimitive.Root>
	)
}

function PickerOptions({
	id,
	label,
	items,
	value,
	activeValue,
	optionId,
	onActiveChange,
	onSelect,
	loading,
}: {
	id: string
	label: string
	items: SearchablePickerItem[]
	value?: string
	activeValue?: string
	optionId: (value: string) => string
	onActiveChange: (value: string) => void
	onSelect: (value: string) => void
	loading: boolean
}) {
	const {ref, scrollerClass} = useFadeScroller('y', undefined, 14)
	useEffect(() => {
		if (activeValue) document.getElementById(optionId(activeValue))?.scrollIntoView({block: 'nearest'})
	}, [activeValue, optionId])

	return (
		<div
			id={id}
			ref={ref}
			role='listbox'
			aria-label={label}
			aria-busy={loading}
			className={cn(
				'min-h-0 overflow-y-auto overscroll-contain [scrollbar-color:rgb(255_255_255/0.15)_transparent] [scrollbar-width:thin]',
				items.length === 0 && 'hidden',
				scrollerClass,
			)}
		>
			{items.map((item) => (
				<div
					key={item.value}
					id={optionId(item.value)}
					lang={item.lang}
					role='option'
					aria-selected={item.value === value}
					data-active={item.value === activeValue || undefined}
					title={item.label}
					className='flex min-h-10 cursor-default items-center gap-2.5 rounded-[var(--picker-inner-radius)] px-3 py-2 text-13 font-medium -tracking-3 text-white/90 data-[active]:bg-white/10 data-[active]:text-white'
					onPointerMove={(event) => {
						if (event.pointerType === 'mouse') onActiveChange(item.value)
					}}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => onSelect(item.value)}
				>
					{item.icon && (
						<span className='flex size-6 shrink-0 items-center justify-center' aria-hidden='true'>
							{item.icon}
						</span>
					)}
					<span className='min-w-0 flex-1 truncate'>{item.label}</span>
					<span className='flex size-4 shrink-0 items-center justify-center'>
						{item.value === value && <Check className='size-4' aria-hidden='true' />}
					</span>
				</div>
			))}
		</div>
	)
}
