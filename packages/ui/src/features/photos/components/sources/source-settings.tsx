import {Check, ChevronDown, MinusCircle, PlusCircle} from 'lucide-react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {MiniBrowser} from '@/features/files/components/mini-browser'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {type ImportScopeMode, type SourceSettings} from '@/features/photos/hooks/use-photo-sources'

// Settings for pull sources that can go stale (auto-import switch, per-drive
// scope) return with the post-v1 source types (drives, shares)

// A chosen folder, shown relative to the source root the way Backups lists
// excluded paths: icon, path, and a minus to drop it. A row of the list card.
function SourcePathRow({path, rootPath, onRemove}: {path: string; rootPath: string; onRemove: () => void}) {
	const {t} = useTranslation()
	const name = path.split('/').filter(Boolean).pop() ?? path
	const displayPath = path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : path
	return (
		<div className='flex items-center justify-between gap-3 px-3.5 py-2.5'>
			<div className='flex min-w-0 flex-1 items-center gap-2.5'>
				<FileItemIcon item={{path, name, type: 'directory', modified: 0, size: 0, operations: []}} className='size-5' />
				<span dir='ltr' className='min-w-0 flex-1 truncate text-left text-13' title={path}>
					{displayPath}
				</span>
			</div>
			<button
				type='button'
				onClick={onRemove}
				aria-label={t('photos-source.scope-remove-folder', {name})}
				className='-mr-1 inline-flex size-6 shrink-0 items-center justify-center text-destructive2-lightest transition-colors hover:text-destructive2-lighter'
			>
				<MinusCircle className='size-4' />
			</button>
		</div>
	)
}

// The folders a scope choice is about — the label and Add over a card of
// rows, with the picker over the source's own tree. Shared by the settings
// here and the This-Umbrel step of the add dialog.
export function ScopeFolderList({
	rootPath,
	scope,
	onChange,
}: {
	rootPath: string
	scope: SourceSettings['scope']
	onChange: (scope: SourceSettings['scope']) => void
}) {
	const {t} = useTranslation()
	const [pickerOpen, setPickerOpen] = useState(false)
	const isOnly = scope.mode === 'only'
	const removePath = (path: string) => onChange({...scope, paths: scope.paths.filter((p) => p !== path)})
	const addPath = (path: string) => {
		if (scope.paths.includes(path)) return
		onChange({...scope, paths: [...scope.paths, path]})
	}

	return (
		<div className='flex flex-col gap-2'>
			<div className='flex items-center justify-between gap-3'>
				<div className='text-13 text-white/60'>
					{isOnly ? t('photos-source.scope-only-folders') : t('photos-source.scope-except-folders')}
				</div>
				<Button size='sm' onClick={() => setPickerOpen(true)}>
					{t('backups-exclusions.add')}
					<PlusCircle className='h-3 w-3' />
				</Button>
			</div>
			<div className='divide-y divide-white/6 rounded-xl border border-white/10 bg-white/5'>
				{scope.paths.length === 0 ? (
					<p className='px-3.5 py-3 text-13 text-white/50'>
						{isOnly ? t('photos-source.scope-only-empty') : t('photos-source.scope-except-empty')}
					</p>
				) : (
					scope.paths.map((path) => (
						<SourcePathRow key={path} path={path} rootPath={rootPath} onRemove={() => removePath(path)} />
					))
				)}
			</div>
			{/* Folder picker over the source's own tree */}
			<MiniBrowser
				open={pickerOpen}
				onOpenChange={setPickerOpen}
				rootPath={rootPath}
				preselectOnOpen={false}
				selectionMode='folders'
				disabledPaths={[rootPath, ...scope.paths]}
				title={isOnly ? t('photos-source.picker-title-only') : t('photos-source.picker-title-except')}
				onSelect={(path) => {
					addPath(path)
					setPickerOpen(false)
				}}
			/>
		</div>
	)
}

// The This-Umbrel scope as one big picker: the Files mark and the current
// choice on the trigger, all three choices with a check in the menu, and the
// folder list beneath when the choice needs one. Shared by the add dialog's
// This-Umbrel step and the source details dialog.
export function UmbrelScopeSettings({
	rootPath,
	scope,
	onChange,
}: {
	rootPath: string
	scope: SourceSettings['scope']
	onChange: (scope: SourceSettings['scope']) => void
}) {
	const {t} = useTranslation()
	const options: {mode: ImportScopeMode; title: string; description: string}[] = [
		{
			mode: 'everything',
			title: t('photos-add-source.umbrel-scope-all'),
			description: t('photos-add-source.umbrel-scope-all-description'),
		},
		{
			mode: 'everything-except',
			title: t('photos-add-source.umbrel-scope-except'),
			description: t('photos-add-source.umbrel-scope-except-description'),
		},
		{
			mode: 'only',
			title: t('photos-add-source.umbrel-scope-only'),
			description: t('photos-add-source.umbrel-scope-only-description'),
		},
	]
	const current = options.find((option) => option.mode === scope.mode) ?? options[0]!

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type='button'
						className='flex w-full items-center gap-3.5 rounded-xl border border-white/10 bg-white/5 p-3 text-left outline-hidden transition-colors hover:bg-white/10'
					>
						<img src='/assets/dock/dock-files.webp' alt='' className='size-10 shrink-0' draggable={false} />
						<span className='min-w-0 flex-1'>
							<span className='block text-sm'>{current.title}</span>
							<span className='mt-0.5 block text-12 leading-relaxed text-white/50'>{current.description}</span>
						</span>
						<ChevronDown className='size-4 shrink-0 text-white/40' />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='start' className='w-(--radix-dropdown-menu-trigger-width)'>
					{options.map((option) => (
						<DropdownMenuItem
							key={option.mode}
							onSelect={() => onChange({mode: option.mode, paths: option.mode === 'everything' ? [] : scope.paths})}
						>
							<span className='min-w-0 flex-1'>
								<span className='block text-14 font-medium'>{option.title}</span>
								<span className='block text-12 text-white/40'>{option.description}</span>
							</span>
							{scope.mode === option.mode && <Check className='ml-3 size-4 shrink-0 text-brand-lighter' />}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			{scope.mode !== 'everything' && <ScopeFolderList rootPath={rootPath} scope={scope} onChange={onChange} />}
		</>
	)
}

// Phones keep their settings in the Umbrel app; there is nothing to configure here
export function PushSourceSettings() {
	const {t} = useTranslation()
	return (
		<p className='rounded-xl border border-white/10 bg-white/5 px-3.5 py-3 text-12 leading-relaxed text-white/60'>
			{t('photos-source.phone-settings-note')}
		</p>
	)
}
