import {Check, Loader2} from 'lucide-react'
import {useTranslation} from 'react-i18next'
import type {IconType} from 'react-icons'
import {HiOutlineDownload} from 'react-icons/hi'
import {VscSync} from 'react-icons/vsc'

import {Button} from '@/components/ui/button'
import {DialogFooter} from '@/components/ui/dialog'
import {CaretRightIcon} from '@/features/files/assets/caret-right'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {FolderPickerRow} from '@/features/files/components/shared/path-breadcrumbs'
import {EXTERNAL_STORAGE_PATH, NETWORK_STORAGE_PATH} from '@/features/files/constants'
import type {CloudSyncMode} from '@/features/files/hooks/use-cloud'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {cn} from '@/lib/utils'

function ModeOption({
	icon: Icon,
	selected,
	title,
	description,
	onClick,
}: {
	icon: IconType
	selected: boolean
	title: string
	description: string
	onClick: () => void
}) {
	return (
		<button
			type='button'
			onClick={onClick}
			className={cn(
				'flex flex-1 items-start gap-3 rounded-xl border p-3 text-left transition-colors',
				selected ? 'border-brand bg-brand/15' : 'border-white/10 bg-white/5 hover:bg-white/10',
			)}
		>
			{/* The mode's glyph rides the title line and takes the brand color
			    with the selection, so state reads at a glance */}
			<Icon
				className={cn('mt-px size-5 shrink-0 transition-colors', selected ? 'text-brand-lighter' : 'text-white/40')}
			/>
			<span className='min-w-0 flex-1'>
				<span className='flex items-center justify-between gap-2 text-sm'>
					<span>{title}</span>
					{selected && (
						<span className='flex size-[18px] shrink-0 items-center justify-center rounded-full bg-brand'>
							<Check className='size-3 text-white' strokeWidth={3.5} />
						</span>
					)}
				</span>
				<span className='mt-1 block text-12 leading-relaxed text-white/50'>{description}</span>
			</span>
		</button>
	)
}

type Crumb = {path: string; name: string; type: 'directory' | 'external-storage' | 'network-share'}

// The destination rendered the way the Files path bar draws it: an icon and
// name per segment with caret separators, minus the navigation
export function DestinationBreadcrumbs({path, homePath}: {path: string; homePath: string}) {
	const {t} = useTranslation()
	const segments = path.split('/').filter(Boolean)

	const crumbs: Crumb[] = []
	if (path.startsWith(`${EXTERNAL_STORAGE_PATH}/`)) {
		crumbs.push({path: `${EXTERNAL_STORAGE_PATH}/${segments[1]}`, name: segments[1], type: 'external-storage'})
		segments.slice(2).forEach((segment, i) => {
			crumbs.push({
				path: [EXTERNAL_STORAGE_PATH, segments[1], ...segments.slice(2, i + 3)].join('/'),
				name: segment,
				type: 'directory',
			})
		})
	} else if (path.startsWith(`${NETWORK_STORAGE_PATH}/`)) {
		crumbs.push({
			path: `${NETWORK_STORAGE_PATH}/${segments[1]}/${segments[2]}`,
			name: segments[2] ?? segments[1],
			type: 'network-share',
		})
		segments.slice(3).forEach((segment, i) => {
			crumbs.push({
				path: [NETWORK_STORAGE_PATH, segments[1], segments[2], ...segments.slice(3, i + 4)].join('/'),
				name: segment,
				type: 'directory',
			})
		})
	} else {
		const homeSegments = path.replace(homePath, '').split('/').filter(Boolean)
		crumbs.push({path: homePath, name: t('files-sidebar.home'), type: 'directory'})
		homeSegments.forEach((segment, i) => {
			crumbs.push({path: [homePath, ...homeSegments.slice(0, i + 1)].join('/'), name: segment, type: 'directory'})
		})
	}

	return (
		<span className='flex min-w-0 items-center gap-1' title={path}>
			{crumbs.map((crumb, index) => (
				<span key={crumb.path} className={cn('flex items-center gap-1.5', index === crumbs.length - 1 && 'min-w-0')}>
					<FileItemIcon
						item={{
							path: crumb.path,
							type: crumb.type,
							name: crumb.name,
							operations: [],
							size: 0,
							modified: 0,
						}}
						className='h-4 w-4 shrink-0 opacity-70'
					/>
					{/* Explicit min-w-0: the automatic flex minimum otherwise keeps this
					    at content width and the name runs under the Change button */}
					<span className='min-w-0 truncate text-sm'>{formatItemName({name: crumb.name})}</span>
					{index < crumbs.length - 1 && <CaretRightIcon className='mt-[1px] shrink-0 text-white/50' />}
				</span>
			))}
		</span>
	)
}

export function DestinationStep({
	providerName,
	destinationPath,
	isProposing,
	changeable,
	wholeCloud,
	mode,
	createBusy,
	isStarting,
	onChange,
	onModeChange,
	onBack,
	onStart,
}: {
	providerName: string
	destinationPath: string | null
	isProposing: boolean
	changeable: boolean
	wholeCloud: boolean
	mode: CloudSyncMode
	createBusy: boolean
	isStarting: boolean
	onChange: () => void
	onModeChange: (mode: CloudSyncMode) => void
	onBack: () => void
	onStart: () => void
}) {
	const {t} = useTranslation()

	const canStart = !isStarting && !isProposing && destinationPath !== null

	return (
		<div className='space-y-4 py-2'>
			<div className='space-y-1.5'>
				<p className='text-13 text-white/60'>{t('files-cloud.destination-save-to')}</p>
				<FolderPickerRow
					path={destinationPath}
					loading={isProposing || !destinationPath}
					onAction={changeable ? onChange : undefined}
					disabled={isProposing}
				/>
			</div>

			{/* Stacked rows absorb the modes' unequal descriptions; side by side,
			    the honest auto-mode copy makes the pair look lopsided */}
			<div className='flex flex-col gap-2'>
				<ModeOption
					icon={VscSync}
					selected={mode === 'auto'}
					title={t('files-cloud.mode-auto')}
					description={
						wholeCloud
							? t('files-cloud.mode-auto-description', {provider: providerName})
							: t('files-cloud.mode-auto-description-folder', {provider: providerName})
					}
					onClick={() => onModeChange('auto')}
				/>
				<ModeOption
					icon={HiOutlineDownload}
					selected={mode === 'one-time'}
					title={t('files-cloud.mode-once')}
					description={
						wholeCloud
							? t('files-cloud.mode-once-description', {provider: providerName})
							: t('files-cloud.mode-once-description-folder', {provider: providerName})
					}
					onClick={() => onModeChange('one-time')}
				/>
			</div>

			{createBusy && (
				<p className='rounded-xl border border-white/10 bg-white/5 p-3 text-13 text-white/60'>
					{t('files-cloud-error.account-busy')}
				</p>
			)}

			<DialogFooter className='gap-2 pt-2'>
				<Button
					variant='primary'
					size='dialog'
					disabled={!canStart}
					onClick={onStart}
					title={destinationPath ?? undefined}
				>
					{isStarting ? <Loader2 className='size-4 animate-spin' /> : t('files-cloud.start')}
				</Button>
				<Button size='dialog' onClick={onBack} disabled={isStarting}>
					{t('back')}
				</Button>
			</DialogFooter>
		</div>
	)
}
