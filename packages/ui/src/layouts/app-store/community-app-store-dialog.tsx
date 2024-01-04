import {DialogDescription} from '@radix-ui/react-dialog'
import {useState} from 'react'
import {toast} from 'sonner'

import {Card} from '@/components/ui/card'
import {CopyableField} from '@/components/ui/copyable-field'
import {LinkButton} from '@/components/ui/link-button'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {useQueryParams} from '@/hooks/use-query-params'
import {UMBREL_APP_STORE_ID} from '@/modules/app-store/constants'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogPortal,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {AnimatedInputError, Input} from '@/shadcn-components/ui/input'
import {Separator} from '@/shadcn-components/ui/separator'
import {trpcReact} from '@/trpc/trpc'

export function CommunityAppStoreDialog() {
	const title = 'Community app stores'
	const {params, removeParam} = useQueryParams()

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
		setLocalError('')
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
		<Dialog
			open={params.get('dialog') === 'add-community-store'}
			onOpenChange={(open) => !open && removeParam('dialog')}
		>
			<DialogPortal>
				<DialogContent className='p-0'>
					<div className='umbrel-dialog-fade-scroller flex flex-col gap-y-3 overflow-y-auto px-5 py-6'>
						<DialogHeader>
							<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
							<DialogTitle>{title}</DialogTitle>
							<DialogDescription className='text-13 text-white/50'>
								Community App Stores allow you to install apps on your Umbrel that may not be available in the official
								Umbrel App Store. They also make it easy to test beta versions of Umbrel apps, then provide valuable
								feedback to developers before they release their apps on the official Umbrel App Store.
							</DialogDescription>
							<a
								href='https://github.com/getumbrel/umbrel-community-app-store'
								className='text-13 text-brand underline'
								target='_blank'
							>
								Learn more
							</a>
						</DialogHeader>
						<p className='rounded-8 bg-yellow-700/50 p-3 text-13 text-yellow-300/80'>
							Community App Stores can be created by anyone. The apps published in them are not verified or vetted by
							the official Umbrel App Store team, and can potentially be insecure or malicious. Use caution and only add
							app stores from developers you trust.
						</p>
						<form onSubmit={handleSubmit}>
							<fieldset disabled={addAppStoreMut.isLoading} className='flex flex-col gap-5'>
								<Input
									placeholder='URL'
									value={url}
									onValueChange={setUrl}
									variant={formError ? 'destructive' : 'default'}
								/>
								<div className='-my-2.5'>
									<AnimatedInputError>{formError}</AnimatedInputError>
								</div>
								<DialogFooter>
									<Button type='submit' variant='primary' size='dialog'>
										Add
									</Button>
								</DialogFooter>
							</fieldset>
						</form>
						<Separator />
						{nonUmbrelAppStores.length === 0 && (
							<div className='text-center text-14 text-white/60'>No community app stores added</div>
						)}
						{nonUmbrelAppStores.map(({url, meta}) => (
							<Card key={meta.id} className='space-y-3'>
								<b>{meta.name}</b>
								{url && <CopyableField value={url} />}
								<div className='flex items-center justify-between'>
									<Button variant='destructive' size='dialog' onClick={() => removeAppStoreMut.mutate({url})}>
										Remove
									</Button>
									<LinkButton size='dialog' className='ml-2' to={`/community-app-store/${meta.id}`}>
										Open
									</LinkButton>
								</div>
							</Card>
						))}
					</div>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}
