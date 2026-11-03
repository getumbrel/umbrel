import {ChevronDown, ExternalLink, Lock} from 'lucide-react'
import {useState, type Ref} from 'react'
import {useTranslation} from 'react-i18next'

import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {cn} from '@/lib/utils'
import {touchTargetClass} from '@/utils/element-classes'

// The most lines the formula opens to, past which it scrolls
const MAX_LINES = 8

// Above the grid: the active cell's reference, which can be typed over to go
// somewhere else, and its formula or value, which can be typed into like the
// cell itself
export function FormulaBar({
	reference,
	value,
	editable,
	lockedReason,
	onExplain,
	error,
	link,
	inputRef,
	onType,
	onCommit,
	onGo,
}: {
	reference: string
	value: string
	editable: boolean
	// Why the cell can't be typed into, when it can't, and what says so when its lock is pressed
	lockedReason?: string
	onExplain: (reason: string) => void
	error?: string
	link?: {label: string; open: () => void}
	inputRef: Ref<HTMLTextAreaElement>
	onType: (value: string) => void
	onCommit: (move: {rows: number; cols: number}) => void
	// Goes to a reference typed into the name box; false when it isn't one
	onGo: (reference: string) => boolean
}) {
	const {t} = useTranslation()
	const [focused, setFocused] = useState(false)
	// A value of several lines shows its first, marked as having more, and all of them, over the grid, while it has
	// the keyboard
	const lines = value.split('\n').length
	const open = focused && lines > 1
	return (
		<div className='settings-edge-material relative flex h-9 shrink-0 items-center rounded-xl bg-black/50 text-13 text-white/85'>
			<NameBox reference={reference} onGo={onGo} />
			<div className='h-4 w-px shrink-0 bg-white/10' />
			<span aria-hidden='true' className='font-serif shrink-0 px-2.5 text-14 text-white/40 italic select-none'>
				fx
			</span>
			<div className='relative min-w-0 flex-1 self-stretch'>
				<textarea
					ref={inputRef}
					aria-label={t('files-sheet.formula-bar')}
					value={value}
					readOnly={!editable}
					dir='auto'
					rows={1}
					wrap='off'
					spellCheck={false}
					autoCapitalize='off'
					autoComplete='off'
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					onChange={(event) => onType(event.target.value)}
					onKeyDown={(event) => {
						if (!editable || event.nativeEvent.isComposing) return
						if (event.key === 'Enter' && !event.altKey) {
							event.preventDefault()
							onCommit({rows: event.shiftKey ? -1 : 1, cols: 0})
						} else if (event.key === 'Enter') {
							// Option-Enter breaks the line within the cell
							event.preventDefault()
							const {selectionStart: start, selectionEnd: end, value: text} = event.currentTarget
							onType(text.slice(0, start) + '\n' + text.slice(end))
						} else if (event.key === 'Tab') {
							// The cell's Tab, not the dialog's focus trap's
							event.preventDefault()
							event.stopPropagation()
							onCommit({rows: 0, cols: event.shiftKey ? -1 : 1})
						}
					}}
					style={open ? {height: (Math.min(lines, MAX_LINES) + 1) * 18} : undefined}
					className={cn(
						'absolute right-0 resize-none leading-[18px] whitespace-pre text-white/90 outline-none',
						// Exactly one line, so the next one's top never shows under it
						open
							? 'top-0 -left-2 z-20 overflow-y-auto rounded-b-xl bg-[#1c1c20] py-[9px] pr-3 pl-2 shadow-[0_8px_24px_rgb(0_0_0/0.4)]'
							: cn('top-[9px] left-0 h-[18px] overflow-hidden bg-transparent py-0', lines > 1 ? 'pr-9' : 'pr-3'),
						!editable && 'text-white/70',
					)}
				/>
				{lines > 1 && !open && (
					// A click on it lands in the field, which then opens
					<ChevronDown
						aria-hidden='true'
						className='pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-white/45'
					/>
				)}
			</div>
			{error && (
				<span
					role='alert'
					className={cn(
						'shrink-0 truncate pr-3 text-12 text-red-300',
						// A phone has no room for it beside the formula: it gets a line of its own under the bar, over the grid
						'max-md:absolute max-md:inset-x-0 max-md:top-full max-md:z-20 max-md:mt-1.5 max-md:rounded-xl max-md:bg-black/75 max-md:px-3 max-md:py-2 max-md:whitespace-normal max-md:shadow-[0_4px_12px_rgb(0_0_0/0.3)] max-md:backdrop-blur-xl',
					)}
				>
					{error}
				</span>
			)}
			{link && (
				<DarkTooltip label={link.label}>
					<button
						type='button'
						aria-label={link.label}
						onClick={link.open}
						className='mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:outline-hidden'
					>
						<ExternalLink className='size-3.5' />
					</button>
				</DarkTooltip>
			)}
			{lockedReason && (
				<DarkTooltip label={lockedReason}>
					{/* A press says why too, since a tooltip never opens on a touch screen */}
					<button
						type='button'
						aria-label={lockedReason}
						onClick={() => onExplain(lockedReason)}
						className={cn(
							touchTargetClass,
							'mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-full text-white/35 transition-colors hover:bg-white/10 hover:text-white/70 focus-visible:bg-white/10 focus-visible:outline-hidden',
						)}
					>
						<Lock className='size-3.5' />
					</button>
				</DarkTooltip>
			)}
		</div>
	)
}

// The reference, which becomes a field while it's being typed over: Enter
// goes there (or, when it isn't one, turns it red, selected to type again),
// leaving it puts back where the selection is
function NameBox({reference, onGo}: {reference: string; onGo: (reference: string) => boolean}) {
	const {t} = useTranslation()
	const [draft, setDraft] = useState<string>()
	const [invalid, setInvalid] = useState(false)
	return (
		<input
			type='text'
			aria-label={t('files-sheet.name-box')}
			aria-invalid={invalid}
			value={draft ?? reference}
			spellCheck={false}
			autoCapitalize='characters'
			autoComplete='off'
			onFocus={(event) => {
				setDraft(reference)
				event.target.select()
			}}
			onBlur={() => {
				setDraft(undefined)
				setInvalid(false)
			}}
			onChange={(event) => {
				setDraft(event.target.value)
				setInvalid(false)
			}}
			onKeyDown={(event) => {
				if (event.key !== 'Enter') return
				event.preventDefault()
				if (onGo((draft ?? '').trim())) return setDraft(undefined)
				setInvalid(true)
				event.currentTarget.select()
			}}
			className={cn(
				'h-7 w-24 shrink-0 truncate rounded-8 bg-transparent px-3 text-center text-white/80 tabular-nums transition-colors outline-none hover:bg-white/6 focus:bg-white/10 max-md:w-20 max-md:px-2',
				invalid && 'text-red-300',
			)}
		/>
	)
}
