import {useTranslation} from 'react-i18next'

import {Cover, CoverRetryActions} from '@/components/ui/cover'
import {RouterOutput, trpcReact} from '@/trpc/trpc'

export function useUpdate({onMutate, onSuccess}: {onMutate?: () => void; onSuccess?: (didWork: boolean) => void}) {
	const updateVersionMut = trpcReact.update.install.useMutation({
		onMutate,
		onSuccess,
	})

	// Given the manifestHash of the release the user was shown, umbreld only installs that one
	const update = (manifestHash?: string) => updateVersionMut.mutate({manifestHash})

	return update
}

export function UpdatingCover({onRetry}: {onRetry: () => void}) {
	const {t} = useTranslation()
	const latestVersionQ = trpcReact.update.check.useQuery()
	const utils = trpcReact.useUtils()
	const isOwner = trpcReact.user.get.useQuery().data?.role === 'owner'
	const updateStatusQ = trpcReact.update.status.useQuery(undefined, {
		refetchInterval: 500,
	})
	// Events keep progress moving between polls. Polling stays as the fallback
	// since the connection drops when the device reboots into the update, and an
	// in-flight poll is cancelled so its older status can't land on top of an event.
	trpcReact.eventBus.listen.useSubscription(
		{event: 'system:update-status'},
		{
			enabled: isOwner,
			onData: (data) => {
				utils.update.status.cancel()
				utils.update.status.setData(undefined, data as RouterOutput['update']['status'])
			},
			onError: (error) => console.error('system:update-status subscription error', error),
		},
	)
	// The version name comes from a separate check that can fail or lag mid-update,
	// so the cover never waits for it
	const latestVersion = latestVersionQ.data

	const {progress, description, running, error} = updateStatusQ.data ?? {}
	const indeterminate = updateStatusQ.isLoading || !running

	if (error) {
		return (
			<Cover
				mark='warning'
				title={t('software-update.failed')}
				description={error}
				actions={<CoverRetryActions retry={t('software-update.failed.retry')} onRetry={onRetry} />}
			/>
		)
	}

	return (
		<Cover
			title={
				latestVersion ? t('software-update.updating-to', {name: latestVersion.name}) : t('software-update.updating')
			}
			progress={indeterminate ? 'indeterminate' : (progress ?? 'indeterminate')}
			// An empty step gets the default too
			status={description || t('connecting')}
		/>
	)
}
