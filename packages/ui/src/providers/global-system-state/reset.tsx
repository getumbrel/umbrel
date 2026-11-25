import {useTranslation} from 'react-i18next'

import {Cover} from '@/components/ui/cover'
import {trpcReact, type RouterError} from '@/trpc/trpc'

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
	const {t} = useTranslation()
	return (
		<Cover
			title={t('factory-reset.rebooting.title')}
			progress='spinner'
			status={t('factory-reset.rebooting.status')}
			note={t('factory-reset.rebooting.message')}
		/>
	)
}
