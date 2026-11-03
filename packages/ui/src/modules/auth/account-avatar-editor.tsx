import {Camera, Loader2, Trash2, Upload} from 'lucide-react'
import {lazy, Suspense, useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {IconButton} from '@/components/ui/icon-button'
import {toast} from '@/components/ui/toast'
import {useHomePath} from '@/features/files/hooks/use-home-path'
import type {FileSystemItem} from '@/features/files/types'
import {cn} from '@/lib/utils'
import {AccountAvatar} from '@/modules/auth/account-avatar'
import {authorizedHttpUrl} from '@/modules/auth/http-auth'
import {useAccountAvatar} from '@/modules/auth/use-account-avatar'
import {touchTargetClass} from '@/utils/element-classes'

type EditableAccount = {userId: string; name: string; avatarUrl?: string}
export type AccountAvatarControlsVisibility = 'always' | 'hover'

const MiniBrowser = lazy(() =>
	import('@/features/files/components/mini-browser').then((module) => ({default: module.MiniBrowser})),
)
const isAvatarImagePath = (path: string) => /\.(jpe?g|png|webp)$/i.test(path)

export function AccountAvatarEditor({
	account,
	disabled = false,
	deferredFile,
	onDeferredFileChange,
	size = 96,
	controlsVisibility = 'always',
	controlsOffset = 'default',
	className,
}: {
	account: EditableAccount
	disabled?: boolean
	deferredFile?: File
	onDeferredFileChange?: (file?: File) => void
	size?: number
	controlsVisibility?: AccountAvatarControlsVisibility
	controlsOffset?: 'default' | 'overlap' | 'wide'
	className?: string
}) {
	const {t} = useTranslation()
	const inputRef = useRef<HTMLInputElement>(null)
	const homePath = useHomePath()
	const avatarMutation = useAccountAvatar()
	const [uploadingFile, setUploadingFile] = useState<File>()
	const [cameraMenuOpen, setCameraMenuOpen] = useState(false)
	const [browserOpen, setBrowserOpen] = useState(false)
	const [isLoadingFromFiles, setIsLoadingFromFiles] = useState(false)
	const previewFile = onDeferredFileChange ? deferredFile : uploadingFile
	const [previewUrl, setPreviewUrl] = useState<string>()

	useEffect(() => {
		if (!previewFile) return setPreviewUrl(undefined)
		const url = URL.createObjectURL(previewFile)
		setPreviewUrl(url)
		return () => URL.revokeObjectURL(url)
	}, [previewFile])

	const isPending = disabled || avatarMutation.isPending || isLoadingFromFiles
	const canRemove = Boolean(onDeferredFileChange ? deferredFile : account.avatarUrl)
	const hideControlsUntilInteraction = controlsVisibility === 'hover' && !isPending && !cameraMenuOpen
	const controlVisibilityClass =
		hideControlsUntilInteraction &&
		'[@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:scale-75 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/avatar-editor:pointer-events-auto [@media(hover:hover)]:group-hover/avatar-editor:scale-100 [@media(hover:hover)]:group-hover/avatar-editor:opacity-100 [@media(hover:hover)]:group-focus-within/avatar-editor:pointer-events-auto [@media(hover:hover)]:group-focus-within/avatar-editor:scale-100 [@media(hover:hover)]:group-focus-within/avatar-editor:opacity-100 origin-center transition-[opacity,scale] duration-150 ease-out delay-0 motion-reduce:scale-100 motion-reduce:transition-none'
	const controlInteractionClass =
		'size-6 p-0 pt-0 duration-150 ease hover:scale-110 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100'
	const removePositionClass =
		controlsOffset === 'wide' ? '-top-3 -left-3' : controlsOffset === 'overlap' ? '-top-1 -left-1' : '-top-2 -left-2'
	const cameraPositionClass =
		controlsOffset === 'wide' ? '-top-3 -right-3' : controlsOffset === 'overlap' ? '-top-1 -right-1' : '-top-2 -right-2'
	const cameraRevealDelayClass =
		hideControlsUntilInteraction && '[@media(hover:hover)]:group-hover/avatar-editor:delay-[70ms]'
	const removeRevealDelayClass =
		hideControlsUntilInteraction && '[@media(hover:hover)]:group-hover/avatar-editor:delay-[130ms]'

	const selectFile = async (file: File) => {
		if (onDeferredFileChange) return onDeferredFileChange(file)
		setUploadingFile(file)
		try {
			await avatarMutation.upload(account.userId, file)
		} catch (error) {
			toast.error(t('avatar.save-failed'), {
				area: 'settings',
				description: error instanceof Error ? error.message : String(error),
			})
		} finally {
			setUploadingFile(undefined)
		}
	}

	const remove = async () => {
		if (onDeferredFileChange) return onDeferredFileChange(undefined)
		try {
			await avatarMutation.remove(account.userId)
		} catch (error) {
			toast.error(t('avatar.remove-failed'), {
				area: 'settings',
				description: error instanceof Error ? error.message : String(error),
			})
		}
	}

	const selectFromFiles = async (path: string) => {
		setBrowserOpen(false)
		setIsLoadingFromFiles(true)
		try {
			const response = await fetch(await authorizedHttpUrl(`/api/files/view?path=${encodeURIComponent(path)}`), {
				headers: {Accept: 'image/jpeg,image/png,image/webp'},
			})
			if (!response.ok) throw new Error('Unable to read image')
			const blob = await response.blob()
			const name = path.split('/').pop() || 'avatar'
			await selectFile(new File([blob], name, {type: blob.type}))
		} catch (error) {
			toast.error(t('avatar.save-failed'), {
				area: 'settings',
				description: error instanceof Error ? error.message : String(error),
			})
		} finally {
			setIsLoadingFromFiles(false)
		}
	}

	return (
		<div className={cn('group/avatar-editor relative shrink-0', className)} style={{width: size, height: size}}>
			<AccountAvatar
				name={account.name}
				userId={account.userId}
				avatarUrl={previewUrl ?? account.avatarUrl}
				size={size}
			/>
			<input
				ref={inputRef}
				type='file'
				accept='image/jpeg,image/png,image/webp'
				disabled={isPending}
				className='sr-only'
				onChange={(event) => {
					const file = event.currentTarget.files?.[0]
					event.currentTarget.value = ''
					if (file) void selectFile(file)
				}}
			/>
			{canRemove && (
				<div className={cn('absolute z-10', removePositionClass, controlVisibilityClass, removeRevealDelayClass)}>
					<IconButton
						type='button'
						icon={Trash2}
						size='icon-only'
						aria-label={t('avatar.remove')}
						title={t('avatar.remove')}
						disabled={isPending}
						onClick={() => void remove()}
						className={cn(
							'border-white/15 bg-black/80 text-white shadow-lg backdrop-blur-md hover:bg-black/90 hover:text-destructive2-lightest',
							touchTargetClass,
							controlInteractionClass,
						)}
					/>
				</div>
			)}
			<DropdownMenu open={cameraMenuOpen} onOpenChange={setCameraMenuOpen}>
				<div className={cn('absolute z-10', cameraPositionClass, controlVisibilityClass, cameraRevealDelayClass)}>
					<DropdownMenuTrigger asChild disabled={isPending}>
						<IconButton
							type='button'
							icon={avatarMutation.isPending || isLoadingFromFiles ? Loader2 : Camera}
							size='icon-only'
							aria-label={account.avatarUrl || previewFile ? t('avatar.replace') : t('avatar.select')}
							title={account.avatarUrl || previewFile ? t('avatar.replace') : t('avatar.select')}
							disabled={isPending}
							className={cn(
								'border-white/15 bg-black/80 text-white shadow-lg backdrop-blur-md hover:bg-black/90',
								touchTargetClass,
								controlInteractionClass,
								(avatarMutation.isPending || isLoadingFromFiles) && '[&_svg]:animate-spin',
							)}
						/>
					</DropdownMenuTrigger>
				</div>
				<DropdownMenuContent align='center' className='w-max max-w-56 p-1'>
					<DropdownMenuItem className='gap-2.5' onSelect={() => inputRef.current?.click()}>
						<Upload className='size-4 shrink-0 opacity-60' />
						{t('files-action.upload')}
					</DropdownMenuItem>
					<DropdownMenuItem className='gap-2.5' onSelect={() => setBrowserOpen(true)}>
						<img src='/assets/dock/dock-files.webp' alt='' className='size-4 shrink-0 rounded-[4px]' />
						{t('files-action.browse-in-files')}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{browserOpen && (
				<Suspense>
					<MiniBrowser
						open={browserOpen}
						onOpenChange={setBrowserOpen}
						rootPath={homePath}
						preselectOnOpen={false}
						selectionMode='files-and-folders'
						selectableFilter={(entry: FileSystemItem) => entry.type === 'file' && isAvatarImagePath(entry.path)}
						onSelect={(path) => void selectFromFiles(path)}
						title={t('avatar.select')}
						selectButtonLabel={t('avatar.select')}
					/>
				</Suspense>
			)}
		</div>
	)
}
