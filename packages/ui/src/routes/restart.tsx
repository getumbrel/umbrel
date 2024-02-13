import {useNavigate} from 'react-router-dom'
import {useEffectOnce} from 'react-use'

import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export default function Restart() {
	const navigate = useNavigate()
	useUmbrelTitle('Restarting...')

	const restartMut = trpcReact.system.reboot.useMutation({
		onSuccess: () => navigate('/'),
	})

	useEffectOnce(() => {
		// Start restart
		restartMut.mutate()
	})

	if (restartMut.isError) {
		return (
			<CoverMessage>
				{t('restart.failed')}
				<Button size='sm' className='inline' onClick={() => restartMut.mutate()}>
					{t('restart.try-again')}
				</Button>
			</CoverMessage>
		)
	}

	return (
		<CoverMessage>
			<Loading>{t('restart.restarting')}</Loading>
			<CoverMessageParagraph>{t('restart.restarting-message')}</CoverMessageParagraph>
		</CoverMessage>
	)
}
