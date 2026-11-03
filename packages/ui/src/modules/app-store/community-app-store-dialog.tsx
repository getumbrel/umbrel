import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbAlertTriangle, TbTrash} from 'react-icons/tb'

import {AppIcon} from '@/components/app-icon'
import {WarningAlert} from '@/components/ui/alert'
import {Badge} from '@/components/ui/badge'
import {Button} from '@/components/ui/button'
import {ButtonLink} from '@/components/ui/button-link'
import {CopyButton} from '@/components/ui/copy-button'
import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogPortal,
	DialogScrollableContent,
	DialogTitle,
} from '@/components/ui/dialog'
import {AnimatedInputError, Input} from '@/components/ui/input'
import {Spinner} from '@/components/ui/loading'
import {toast} from '@/components/ui/toast'
import {UMBREL_APP_STORE_ID} from '@/constants/app-store'
import {cn} from '@/lib/utils'
import {systemAppsKeyed} from '@/providers/apps'
import {useConfirmation} from '@/providers/confirmation'
import {trpcReact} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'

export function CommunityAppStoreDialog() {
	const {t} = useTranslation()
	const title = t('app-store.menu.community-app-stores')
	const dialogProps = useDialogOpenProps('add-community-store')

	// state

	const [url, setUrl] = useState('')
	const [localError, setLocalError] = useState('')

	// queries

	const appStoresQ = trpcReact.appStore.repositories.useQuery()
	// Already cached by the App Store; only used for the per-store app count
	const registryQ = trpcReact.appStore.registry.useQuery()
	const utils = trpcReact.useUtils()

	// mutations

	const addAppStoreMut = trpcReact.appStore.addRepository.useMutation({
		onSuccess: () => {
			setUrl('')
			setLocalError('')
			appStoresQ.refetch()
			utils.appStore.registry.invalidate()
		},
	})

	const removeAppStoreMut = trpcReact.appStore.removeRepository.useMutation({
		onSuccess: () => {
			appStoresQ.refetch()
			utils.appStore.registry.invalidate()
		},
		onError: (err) => {
			toast.error(t('community-app-store.remove-error', {message: err.message}), {area: 'app-store'})
		},
	})

	// Apps installed from a store stay, but lose its page and its updates, so removing asks first
	const confirm = useConfirmation()
	const removeAppStore = async ({url, name}: {url: string; name: string}) => {
		const result = await confirm({
			title: t('community-app-stores.remove-confirm-title', {name}),
			message: t('community-app-stores.remove-confirm-message'),
			actions: [
				{label: t('community-app-store.remove-button'), value: 'remove', variant: 'destructive'},
				{label: t('cancel'), value: 'cancel', variant: 'default'},
			],
		}).catch(() => undefined)
		if (result?.actionValue === 'remove') removeAppStoreMut.mutate({url})
	}

	// handlers

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		addAppStoreMut.reset()
		// So setLocalError('') is not batched
		await setLocalError('')
		e.preventDefault()
		const trimmedUrl = url.trim()
		if (!trimmedUrl) {
			setLocalError(t('community-app-stores.url-required'))
			return
		}
		if (appStoresQ.data?.some((store) => store?.url === trimmedUrl)) {
			setLocalError(t('community-app-stores.already-added'))
			return
		}
		addAppStoreMut.mutate({url: trimmedUrl})
	}

	// Shown under the field only, not also as a toast. The backend's reasons are raw URL and git
	// errors (a repository that doesn't exist reports "HTTP Error: 401 Unauthorized"), so any
	// failure gets one plain message.
	const remoteFormError = addAppStoreMut.error ? t('community-app-stores.add-failed') : ''
	const formError = localError || remoteFormError

	const nonUmbrelAppStores = (appStoresQ.data ?? [])
		.filter((store) => store !== null)
		.filter((store) => store.meta.id !== UMBREL_APP_STORE_ID)

	const appCountByStore = new Map(
		(registryQ.data ?? []).filter((repo) => repo !== null).map((repo) => [repo.meta.id, repo.apps.length]),
	)

	const removingUrl = removeAppStoreMut.isPending ? removeAppStoreMut.variables?.url : undefined

	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogScrollableContent className='umbrel-app-store-modal'>
					<div className='umbrel-dialog-fade-scroller umbrel-stable-gutter flex flex-col gap-y-5 overflow-y-auto px-5 py-6'>
						<DialogHeader className='space-y-2'>
							<DialogTitle>{title}</DialogTitle>
							<DialogDescription className='text-13 leading-snug -tracking-2 text-white/50'>
								{t('community-app-stores.description')}{' '}
								<a
									href='https://github.com/getumbrel/umbrel-community-app-store'
									className='text-brand underline-offset-2 outline-hidden hover:underline focus-visible:underline'
									target='_blank'
									rel='noreferrer'
								>
									{t('community-app-stores.learn-more')}
								</a>
							</DialogDescription>
						</DialogHeader>

						<WarningAlert icon={TbAlertTriangle} description={t('community-app-stores.warning')} />

						<form onSubmit={handleSubmit} className='flex flex-col gap-2'>
							<fieldset disabled={addAppStoreMut.isPending} className='flex flex-col gap-2.5 md:flex-row'>
								<Input
									placeholder={t('community-app-stores.url-placeholder')}
									value={url}
									onValueChange={setUrl}
									variant={formError ? 'destructive' : 'default'}
									sizeVariant='short'
									className='px-4'
									autoCapitalize='off'
									autoCorrect='off'
									spellCheck={false}
									inputMode='url'
									aria-label={t('url')}
								/>
								<Button type='submit' variant='primary' size='input-short' className='shrink-0'>
									{addAppStoreMut.isPending ? <Spinner /> : t('community-app-stores.add-button')}
								</Button>
							</fieldset>
							<AnimatedInputError>{formError}</AnimatedInputError>
						</form>

						<section className='flex flex-col gap-2'>
							<h3 className='px-1 text-12 font-medium -tracking-2 text-white/40'>
								{t('community-app-stores.added-title')}
							</h3>
							{nonUmbrelAppStores.length === 0 ? (
								<div className='flex items-center justify-center rounded-12 border border-dashed border-white/10 px-4 py-6 text-center text-13 -tracking-2 text-white/30'>
									{t('community-app-stores.empty')}
								</div>
							) : (
								// contain-inline-size: the scroll area's display:table wrapper would otherwise
								// grow to the untruncated URL and push rows past the dialog
								<ul className='flex flex-col gap-2.5 contain-inline-size md:gap-0 md:divide-y md:divide-white/6 md:overflow-hidden md:rounded-12 md:bg-white/5'>
									{nonUmbrelAppStores.map(({url, meta}) => {
										const appCount = appCountByStore.get(meta.id)
										const removing = removingUrl === url
										const removeLabel = t('community-app-store.remove-button')
										return (
											<li
												key={meta.id}
												className={cn(
													// Mobile: a centered tile. Desktop: a compact row on a grid whose
													// middle track is minmax(0,1fr), so the URL truncates instead of
													// running under the buttons.
													'flex flex-col items-center gap-3 overflow-hidden rounded-12 bg-white/5 px-4 py-5 text-center transition-opacity duration-300',
													'md:grid md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:rounded-none md:bg-transparent md:px-3 md:py-3 md:text-left',
													removing && 'pointer-events-none opacity-40',
												)}
											>
												<AppIcon
													src={systemAppsKeyed['UMBREL_app-store'].icon}
													className='size-14 rounded-12 border-0 bg-transparent md:size-10 md:rounded-10'
												/>
												<div className='flex w-full min-w-0 flex-col items-center gap-1 overflow-hidden md:items-start md:gap-0.5'>
													<div className='flex max-w-full min-w-0 items-center gap-2'>
														<span
															className='min-w-0 truncate text-15 font-medium -tracking-2 md:text-14'
															title={meta.name}
														>
															{meta.name}
														</span>
														{appCount !== undefined && (
															<Badge className='shrink-0 border-0 px-2 py-1 text-11 text-white/60'>
																{t('community-app-stores.app-count', {count: appCount})}
															</Badge>
														)}
													</div>
													<div className='flex max-w-full min-w-0 items-center gap-1.5 text-12 -tracking-2 text-white/40'>
														<span className='min-w-0 truncate font-mono' title={url}>
															{url.replace(/^https?:\/\//, '')}
														</span>
														<CopyButton value={url} />
													</div>
												</div>
												{/* Mobile: full-width stacked actions */}
												<div className='flex w-full flex-col gap-2 md:hidden'>
													<ButtonLink size='dialog' variant='primary' to={`/community-app-store/${meta.id}`}>
														{t('community-app-store.open-button')}
													</ButtonLink>
													<Button
														size='dialog'
														text='destructive'
														disabled={removing}
														onClick={() => removeAppStore({url, name: meta.name})}
													>
														{removing ? <Spinner /> : removeLabel}
													</Button>
												</div>
												{/* Desktop: inline actions */}
												<div className='hidden shrink-0 items-center gap-1.5 md:flex'>
													<ButtonLink size='sm' to={`/community-app-store/${meta.id}`}>
														{t('community-app-store.open-button')}
													</ButtonLink>
													<DarkTooltip label={removeLabel}>
														<button
															type='button'
															aria-label={removeLabel}
															disabled={removing}
															onClick={() => removeAppStore({url, name: meta.name})}
															className='flex size-[25px] items-center justify-center rounded-full text-white/40 transition-colors duration-300 hover:bg-destructive2/20 hover:text-destructive2-lightest focus:outline-hidden focus-visible:bg-destructive2/20 focus-visible:text-destructive2-lightest'
														>
															{removing ? <Spinner /> : <TbTrash className='size-4' />}
														</button>
													</DarkTooltip>
												</div>
											</li>
										)
									})}
								</ul>
							)}
						</section>
					</div>
				</DialogScrollableContent>
			</DialogPortal>
		</Dialog>
	)
}
