import {Fragment} from 'react'
import {Link} from 'react-router-dom'

import {LOADING_DASH, UNKNOWN} from '@/constants'
import {useDeviceInfo} from '@/hooks/use-device-info'
import {useLanguage} from '@/hooks/use-language'
import {trpcReact} from '@/trpc/trpc'
import {duration} from '@/utils/date-time'
import {t} from '@/utils/i18n'

export function SettingsSummary() {
	const [languageCode] = useLanguage()
	const deviceInfo = useDeviceInfo()
	const osVersionQ = trpcReact.system.version.useQuery()
	const uptimeQ = trpcReact.system.uptime.useQuery()
	const ipAddresses = trpcReact.system.getIpAddresses.useQuery()

	return (
		<dl
			className='grid grid-cols-2 items-center gap-x-5 gap-y-2 text-14 leading-none -tracking-2'
			style={{
				// Makes columns not all the same width
				gridTemplateColumns: 'auto auto',
			}}
		>
			<dt className='opacity-40'>{t('device')}</dt>
			<dd>{deviceInfo.data?.device || LOADING_DASH}</dd>
			<dt className='opacity-40'>{t('umbrelos')}</dt>
			<dd>{osVersionQ.isLoading ? LOADING_DASH : (`${osVersionQ.data?.name}` ?? UNKNOWN())}</dd>
			<dt className='opacity-40'>{t('local-ip')}</dt>
			<dd>
				{ipAddresses.data?.length
					? ipAddresses.data.map((ip: string, index: number) => (
							<Fragment key={ip}>
								<Link to={`http://${ip}`} target='_blank'>
									{ip}
								</Link>
								{index < ipAddresses.data.length - 1 && ', '}
							</Fragment>
						))
					: LOADING_DASH}
			</dd>
			<dt className='opacity-40'>{t('uptime')}</dt>
			<dd>{uptimeQ.isLoading ? LOADING_DASH : duration(uptimeQ.data, languageCode)}</dd>
		</dl>
	)
}
