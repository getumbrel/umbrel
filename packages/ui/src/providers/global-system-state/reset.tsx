import {BarePage} from '@/layouts/bare/bare-page'
import {ProgressLayout} from '@/modules/bare/progress-layout'
import {trpcReact, type RouterError} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export function useReset({onMutate, onError}: {onMutate?: () => void; onError?: (err: RouterError) => void}) {
	const resetMut = trpcReact.system.factoryReset.useMutation({
		onMutate,
		onError,
	})

	const reset = (password: string) => resetMut.mutate({password})

	return reset
}

// The device reboots immediately and we delete old state in the background on boot,
// so there is no progress to show. We just show a loading indicator.
export function ResettingCover() {
	return (
		<BarePage>
			<ProgressLayout
				title={t('factory-reset.rebooting.title')}
				callout={t('factory-reset.rebooting.message')}
				message={t('factory-reset.rebooting.status')}
				isRunning
			/>
		</BarePage>
	)
}
