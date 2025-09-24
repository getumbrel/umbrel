import React, {useEffect, useState} from 'react'
import {useForm} from 'react-hook-form'

import {FadeInImg} from '@/components/ui/fade-in-img'
import {useQueryParams} from '@/hooks/use-query-params'
import {Button} from '@/shadcn-components/ui/button'
import {Checkbox} from '@/shadcn-components/ui/checkbox'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogPortal,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {Input} from '@/shadcn-components/ui/input'
import {Labeled} from '@/shadcn-components/ui/input'
import {trpcReact} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

import {useIconBackground} from './use-icon-background'

type BookmarkFormData = {
	name: string
	url: string
	openInNewTab: boolean
	customIcon?: string
}

export type Bookmark = {
	id: string
	name: string
	url: string
	openInNewTab: boolean
	icon?: string
}

export function BookmarkDialog() {
	const dialogKey = 'add-bookmark'
	const {open, onOpenChange} = useDialogOpenProps(dialogKey)
	const {params} = useQueryParams()
	const utils = trpcReact.useUtils()
	const bookmarksQuery = trpcReact.user.bookmarks.useQuery()
	const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null)
	const [hasManualName, setHasManualName] = useState(false)
	const [hasManualIcon, setHasManualIcon] = useState(false)

	const addBookmarkMut = trpcReact.user.addBookmark.useMutation({
		onSuccess: () => {
			utils.user.bookmarks.invalidate()
			utils.user.get.invalidate()
			onOpenChange(false)
			reset()
		},
	})

	const updateBookmarkMut = trpcReact.user.updateBookmark.useMutation({
		onSuccess: () => {
			utils.user.bookmarks.invalidate()
			utils.user.get.invalidate()
			onOpenChange(false)
			reset()
			setEditingBookmark(null)
		},
	})

	const {register, handleSubmit, reset, setValue, watch} = useForm<BookmarkFormData>({
		defaultValues: {
			name: '',
			url: '',
			openInNewTab: false,
			customIcon: '',
		},
	})

	const url = watch('url')
	const customIcon = watch('customIcon')
	const previewBackgroundColor = useIconBackground(customIcon)

	const updateFavicon = async (urlValue: string) => {
		if (urlValue) {
			try {
				// Auto-add https:// for parsing if no protocol
				let fullUrl = urlValue.trim()
				if (!fullUrl.match(/^https?:\/\//i)) {
					fullUrl = 'https://' + fullUrl
				}
				const urlObj = new URL(fullUrl)
				const domain = urlObj.hostname
				
				// Fetch favicon through backend proxy to avoid CORS
				const faviconDataUrl = await utils.user.getFavicon.fetch({domain})
				
				// Load the image and check if it's valid (not a 404 placeholder)
				// Only update if user hasn't uploaded a custom icon
				if (!hasManualIcon) {
					const img = new Image()
					img.onload = () => {
						// Google's 404 placeholder is 16x16, filter those out
						if (img.naturalWidth > 16 && img.naturalHeight > 16) {
							setValue('customIcon', faviconDataUrl)
						}
					}
					img.onerror = () => {
						// Failed to load, do nothing
					}
					img.src = faviconDataUrl
				}

				// Fetch page title and update name (only if user hasn't manually entered a name)
				if (!hasManualName) {
					try {
						const title = await utils.user.getPageTitle.fetch({url: fullUrl})
						// Don't set if title is "Error" or similar error messages
						if (title && title !== 'Error' && !title.toLowerCase().includes('error')) {
							setValue('name', title)
						}
					} catch {
						// Failed to fetch title, ignore
					}
				}
			} catch {
				// Invalid URL, ignore
			}
		}
	}

	const handleUrlKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
		const target = e.target as HTMLInputElement
		// Small delay to ensure the input value is updated
		setTimeout(() => {
			updateFavicon(target.value)
		}, 10)
	}

	// Handle loading bookmark for edit
	useEffect(() => {
		if (open) {
			// Check if we're editing (params are prefixed with dialog key by linkToDialog)
			const editId = params.get('add-bookmark-id')
			if (editId && bookmarksQuery.data) {
				// Find the bookmark to edit
				const bookmark = bookmarksQuery.data.find((b: Bookmark) => b.id === editId)
				if (bookmark) {
					setEditingBookmark(bookmark)
					// Use reset with values to properly set form state
					reset({
						name: bookmark.name,
						url: bookmark.url,
						openInNewTab: bookmark.openInNewTab,
						customIcon: bookmark.icon || '',
					})
					// When editing, consider existing values as manual to prevent override
					setHasManualName(!!bookmark.name)
					setHasManualIcon(!!bookmark.icon)
				}
			} else if (!editId) {
				// Not editing, reset form for new bookmark
				reset({
					name: '',
					url: '',
					openInNewTab: false,
					customIcon: '',
				})
				setEditingBookmark(null)
				setHasManualName(false)
				setHasManualIcon(false)
			}
		} else {
			reset()
			setEditingBookmark(null)
			setHasManualName(false)
			setHasManualIcon(false)
		}
	}, [open, params, bookmarksQuery.data, reset])

	const onSubmit = (data: BookmarkFormData) => {
		// Auto-add https:// if no protocol specified
		let url = data.url.trim()
		if (!url.match(/^https?:\/\//i)) {
			url = 'https://' + url
		}

		const bookmark = {
			id: editingBookmark?.id || `b${Date.now().toString(36)}`,
			name: data.name,
			url: url,
			openInNewTab: data.openInNewTab,
			icon: data.customIcon,
		}

		if (editingBookmark) {
			updateBookmarkMut.mutate(bookmark)
		} else {
			addBookmarkMut.mutate(bookmark)
		}
	}

	const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file && file.type.startsWith('image/')) {
			const reader = new FileReader()
			reader.onload = () => {
				setValue('customIcon', reader.result as string)
				setHasManualIcon(true)
			}
			reader.readAsDataURL(file)
		}
		// Reset the input so the same file can be selected again
		e.target.value = ''
	}

	const iconInputRef = React.useRef<HTMLInputElement>(null)

	const handleIconClick = () => {
		iconInputRef.current?.click()
	}

	const title = editingBookmark ? t('desktop.bookmark.dialog.title-edit') : t('desktop.bookmark.dialog.title-add')

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogPortal>
				<DialogContent>
					<form onSubmit={handleSubmit(onSubmit)}>
						<fieldset disabled={addBookmarkMut.isPending || updateBookmarkMut.isPending}>
							<DialogHeader>
								<DialogTitle>{title}</DialogTitle>
							</DialogHeader>
							<div className='flex gap-4 py-4'>
								<div className='flex flex-1 flex-col gap-4'>
									<Labeled label={t('desktop.bookmark.dialog.url-label')}>
										<Input
											{...register('url', {required: true})}
											placeholder={t('desktop.bookmark.dialog.url-placeholder')}
											type='url'
											onKeyUp={handleUrlKeyPress}
										/>
									</Labeled>
									<Labeled label={t('desktop.bookmark.dialog.name-label')}>
										<Input
											{...register('name', {
												required: true,
												onChange: (e) => {
													if (e.target.value) {
														setHasManualName(true)
													}
												},
											})}
											placeholder={t('desktop.bookmark.dialog.name-placeholder')}
										/>
									</Labeled>
									<div className='flex items-center gap-2'>
										<Checkbox
											id='openInNewTab'
											checked={watch('openInNewTab')}
											onCheckedChange={(checked) => setValue('openInNewTab', !!checked)}
										/>
										<label htmlFor='openInNewTab' className='text-sm'>
											{t('desktop.bookmark.dialog.open-in-new-tab')}
										</label>
									</div>
								</div>
								<div className='flex flex-col items-center gap-2'>
									<button
										type='button'
										onClick={handleIconClick}
										className='group relative aspect-square w-20 cursor-pointer overflow-hidden rounded-12 bg-white/10 ring-white/25 transition-all hover:scale-105 hover:ring-4'
									>
										{customIcon ? (
											<>
												{/* Background fill for images with uniform edges */}
												{previewBackgroundColor && (
													<div className='absolute inset-0' style={{backgroundColor: previewBackgroundColor}} />
												)}
												<FadeInImg
													src={customIcon}
													alt='Icon preview'
													className='relative z-10 h-full w-full object-cover'
												/>
											</>
										) : (
											<div className='flex h-full w-full items-center justify-center text-white/30'>
												{t('desktop.bookmark.dialog.upload-icon')}
											</div>
										)}
									</button>
									<input
										ref={iconInputRef}
										type='file'
										accept='image/*'
										onChange={handleIconUpload}
										className='hidden'
									/>
								</div>
							</div>
							<DialogFooter>
								<Button type='submit' size='dialog' variant='primary'>
									{editingBookmark ? t('confirm') : t('desktop.bookmark.add')}
								</Button>
								<Button type='button' size='dialog' onClick={() => onOpenChange(false)}>
									{t('cancel')}
								</Button>
							</DialogFooter>
						</fieldset>
					</form>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}
