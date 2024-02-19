import {useNavigate} from 'react-router-dom'
import {useEffectOnce} from 'react-use'

import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {Button} from '@/shadcn-components/ui/button'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export default function Restart() {
	const navigate = useNavigate()

	const restartMut = trpcReact.system.reboot.useMutation({
		onSuccess: () => navigate('/'),
	})

	useEffectOnce(() => {
		// Start restart
		restartMut.mutate()
	})

	if (restartMut.isError) {
		const title = t('restart.failed')
		return (
			<CoverMessage>
				<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
				{title}
				<Button size='sm' className='inline' onClick={() => restartMut.mutate()}>
					{t('restart.try-again')}
				</Button>
			</CoverMessage>
		)
	}

	const title = t('restart.restarting')
	return (
		<CoverMessage>
			{/* TODO: add translation */}
			<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
			<Loading>{title}</Loading>
			<CoverMessageParagraph>{t('restart.restarting-message')}</CoverMessageParagraph>
		</CoverMessage>
	)
}
