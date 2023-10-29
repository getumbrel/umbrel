import {ReactNode} from 'react'

import {RegistryApp} from '@/trpc/trpc'

import {cardClass, cardTitleClass} from './shared'

export const InfoSection = ({app}: {app: RegistryApp}) => (
	<div className={cardClass}>
		<h2 className={cardTitleClass}>Info</h2>
		<KV k='Version' v={app.version} />
		{app.repo && (
			<KV
				k='Source Code'
				v={
					<a href={app.repo} target='_blank' className='text-brand-lighter'>
						Public
					</a>
				}
			/>
		)}
		<KV
			k='Developer'
			v={
				<a href={app.website} target='_blank' className='text-brand-lighter'>
					{app.developer}
				</a>
			}
		/>
		{app.submission && app.submitter && (
			<KV
				k='Submitted by'
				v={
					<a href={app.submission} target='_blank' className='text-brand-lighter'>
						{app.submitter}
					</a>
				}
			/>
		)}
		<KV k='Compatibility' v='Compatible' />
	</div>
)

function KV({k, v}: {k: ReactNode; v: ReactNode}) {
	return (
		<div className='flex flex-row items-center gap-2'>
			<span className='flex-1 text-14 opacity-50'>{k}</span>
			<span className='text-right text-14 font-medium'>{v || 'Unknown'}</span>
		</div>
	)
}
