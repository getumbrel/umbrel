import {BarePage} from '@/layouts/bare/bare-page'
import FailedLayout from '@/modules/bare/failed-layout'
import {ProgressLayout} from '@/modules/bare/progress-layout'
import {trpcReact, type RouterError} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export function useReset({
	onMutate,
	onSuccess,
	onError,
}: {
	onMutate?: () => void
	onSuccess?: (didWork: boolean) => void
	onError?: (err: RouterError) => void
}) {
	const resetMut = trpcReact.system.factoryReset.useMutation({
		onMutate,
		onSuccess,
		onError,
	})

	const reset = (password: string) => resetMut.mutate({password})

	return reset
}

export function ResettingCover() {
	const resetStatusQ = trpcReact.system.getFactoryResetStatus.useQuery(undefined, {
		refetchInterval: 500,
	})

	const {progress, description, running, error} = resetStatusQ.data ?? {}
	const indeterminate = resetStatusQ.isLoading || !running

	return (
		<BarePage>
			{!error && (
				<ProgressLayout
					title={t('factory-reset')}
					callout={t('factory-reset.resetting.dont-turn-off-device')}
					progress={indeterminate ? undefined : progress}
					message={description}
					isRunning={!!running}
				/>
			)}
			{error && (
				<FailedLayout
					title={t('factory-reset.failed.title')}
					description={
						<>
							{t('factory-reset.failed.message')}: {error}
						</>
					}
					buttonText={t('factory-reset.failed.retry')}
					buttonOnClick={() => (document.location.href = '/factory-reset')}
				/>
			)}
		</BarePage>
	)
}
