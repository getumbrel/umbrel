import {DialogDescription} from '@radix-ui/react-dialog'
import {useState} from 'react'
import {toast} from 'sonner'

import {ButtonLink} from '@/components/ui/button-link'
import {Card} from '@/components/ui/card'
import {CopyableField} from '@/components/ui/copyable-field'
import {UMBREL_APP_STORE_ID} from '@/modules/app-store/constants'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogFooter,
	DialogHeader,
	DialogPortal,
	DialogScrollableContent,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {AnimatedInputError, Input} from '@/shadcn-components/ui/input'
import {Separator} from '@/shadcn-components/ui/separator'
import {trpcReact} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export function CommunityAppStoreDialog() {
	const title = t('app-store.menu.community-app-stores')
	const dialogProps = useDialogOpenProps('add-community-store')

	// state

	const [url, setUrl] = useState('')
	const [localError, setLocalError] = useState('')

	// queries

	const appStoresQ = trpcReact.appStore.registry.useQuery()

	// mutations

	const addAppStoreMut = trpcReact.appStore.addRepository.useMutation({
		onSuccess: () => {
			toast.success('Added community app store')
			setUrl('')
			setLocalError('')
			appStoresQ.refetch()
		},
		onError: (err) => {
			toast.error(err.message)
		},
	})

	const removeAppStoreMut = trpcReact.appStore.removeRepository.useMutation({
		onSuccess: () => {
			toast.success('Removed community app store')
			appStoresQ.refetch()
		},
		onError: (err) => {
			toast.error(err.message)
		},
	})

	// handlers

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		addAppStoreMut.reset()
		// So setLocalError('') is not batched
		await setLocalError('')
		e.preventDefault()
		if (!url) {
			setLocalError('URL is required')
			return
		}
		addAppStoreMut.mutate({url})
	}

	const remoteFormError = !addAppStoreMut.error?.data?.zodError && addAppStoreMut.error?.message
	const formError = localError || remoteFormError

	const nonUmbrelAppStores = (appStoresQ.data ?? [])
		.filter((store) => store?.meta.id !== UMBREL_APP_STORE_ID)
		.filter((store) => store !== null)
		.map((store) => store!)

	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogScrollableContent showClose>
					<div className='umbrel-dialog-fade-scroller flex flex-col gap-y-3 overflow-y-auto px-5 py-6'>
						<DialogHeader>
							<DialogTitle>{title}</DialogTitle>
							<DialogDescription className='text-13 text-white/50'>
								{t('community-app-stores.description')}
							</DialogDescription>
							<a
								href='https://github.com/getumbrel/umbrel-community-app-store'
								className='text-13 text-brand underline'
								target='_blank'
							>
								{t('community-app-stores.learn-more')}
							</a>
						</DialogHeader>
						<p className='rounded-8 bg-yellow-700/50 p-3 text-13 text-yellow-300/80'>
							{t('community-app-stores.warning')}
						</p>
						<form onSubmit={handleSubmit}>
							<fieldset disabled={addAppStoreMut.isPending} className='flex flex-col gap-5'>
								<Input
									placeholder={t('url')}
									value={url}
									onValueChange={setUrl}
									variant={formError ? 'destructive' : 'default'}
								/>
								<div className='-my-2.5'>
									<AnimatedInputError>{formError}</AnimatedInputError>
								</div>
								<DialogFooter>
									<Button type='submit' variant='primary' size='dialog'>
										{t('community-app-stores.add-button')}
									</Button>
								</DialogFooter>
							</fieldset>
						</form>
						<Separator />
						{nonUmbrelAppStores.map(({url, meta}) => (
							<Card key={meta.id} className='shrink-0 space-y-3'>
								<b>
									{meta.name} {t('community-app-store')}
								</b>
								{url && <CopyableField value={url} />}
								<div className='flex items-center justify-between'>
									<Button
										variant='destructive'
										size='dialog'
										className='w-auto'
										onClick={() => removeAppStoreMut.mutate({url})}
									>
										{t('community-app-store.remove-button')}
									</Button>
									<ButtonLink size='dialog' className='ml-2 w-auto' to={`/community-app-store/${meta.id}`}>
										{t('community-app-store.open-button')}
									</ButtonLink>
								</div>
							</Card>
						))}
					</div>
				</DialogScrollableContent>
			</DialogPortal>
		</Dialog>
	)
}
