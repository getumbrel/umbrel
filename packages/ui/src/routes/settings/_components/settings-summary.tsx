import {Fragment, ReactNode} from 'react'
import {useTranslation} from 'react-i18next'

import {LOADING_DASH, UNKNOWN} from '@/constants'
import {useLanguage} from '@/hooks/use-language'
import {cn} from '@/lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {duration} from '@/utils/date-time'

export function SettingsSummary({className}: {className?: string}) {
	const {t} = useTranslation()
	const [languageCode] = useLanguage()
	const deviceNameQ = trpcReact.system.deviceName.useQuery()
	const osVersionQ = trpcReact.system.version.useQuery()
	const uptimeQ = trpcReact.system.uptime.useQuery()
	const ipAddresses = trpcReact.system.getIpAddresses.useQuery()
	const localIpValue = ipAddresses.data?.length ? (
		<span className='whitespace-normal select-text'>
			{ipAddresses.data.map((ipAddress, index) => (
				<Fragment key={ipAddress}>
					{index > 0 && ' '}
					<span className='whitespace-nowrap'>
						{ipAddress}
						{index < ipAddresses.data.length - 1 && ','}
					</span>
				</Fragment>
			))}
		</span>
	) : (
		LOADING_DASH
	)

	return (
		<dl
			className={cn(
				'settings-edge-material shrink-0 divide-y divide-white/8 overflow-hidden rounded-24 text-13 -tracking-2',
				className,
			)}
		>
			<SummaryRow
				label={t('running')}
				value={osVersionQ.isLoading ? LOADING_DASH : (osVersionQ.data?.name ?? UNKNOWN())}
			/>
			<SummaryRow label={t('device')} value={deviceNameQ.data || LOADING_DASH} />
			<SummaryRow label={t('local-ip')} value={localIpValue} />
			<SummaryRow label={t('uptime')} value={uptimeQ.isLoading ? LOADING_DASH : duration(uptimeQ.data, languageCode)} />
		</dl>
	)
}

function SummaryRow({label, value}: {label: string; value: ReactNode}) {
	return (
		// A value that doesn't fit beside its label moves under it, and is only cut if it's wider than the row
		<div className='flex min-h-[46px] flex-wrap items-center justify-between gap-x-4 gap-y-0.5 px-5 py-2'>
			<dt className='shrink-0 font-semibold whitespace-nowrap text-white/45'>{label}</dt>
			<dd className='ml-auto max-w-full min-w-0 truncate text-right font-medium text-white'>{value}</dd>
		</div>
	)
}
