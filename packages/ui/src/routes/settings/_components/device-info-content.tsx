import {TbQuestionMark} from 'react-icons/tb'

import {CopyButton} from '@/components/ui/copy-button'
import {FadeInImg} from '@/components/ui/fade-in-img'
import {hostEnvironmentMap, UmbrelHostEnvironment} from '@/constants'
import {cn} from '@/shadcn-lib/utils'
import {maybeT, t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

import AnimatedUmbrelHomeIcon from './device-info-umbrel-home'

export function DeviceInfoContent({
	umbrelHostEnvironment,
	device,
	modelNumber,
	serialNumber,
}: {
	umbrelHostEnvironment?: UmbrelHostEnvironment
	device?: string
	modelNumber?: string
	serialNumber?: string
}) {
	return (
		<div className='space-y-6'>
			<div className='flex justify-center py-2'>
				<HostEnvironmentIcon
					environment={umbrelHostEnvironment}
					modelNumber={modelNumber}
					serialNumber={serialNumber}
				/>
			</div>
			<div className={listClass}>
				<div className={listItemClassNarrow}>
					<span>{t('device-info.device')}</span>
					<span className={cn('font-normal', (modelNumber || serialNumber) && 'pr-6')}>{maybeT(device)}</span>
				</div>
				{modelNumber && (
					<div className={listItemClassNarrow}>
						<span>{t('device-info.model-number')}</span>
						<span className='flex items-center gap-2 font-normal'>
							{modelNumber} <CopyButton value={modelNumber} />
						</span>
					</div>
				)}
				{serialNumber && (
					<div className={listItemClassNarrow}>
						<span>{t('device-info.serial-number')}</span>
						<span className='flex items-center gap-2 font-normal'>
							{serialNumber} <CopyButton value={serialNumber} />
						</span>
					</div>
				)}
			</div>
		</div>
	)
}
const listClass = tw`divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6`
const listItemClass = tw`flex items-center gap-3 px-3 h-[50px] text-15 font-medium -tracking-3 justify-between`
const listItemClassNarrow = cn(listItemClass, tw`h-[42px]`)

export const HostEnvironmentIcon = ({
	environment,
	modelNumber,
	serialNumber,
}: {
	environment?: UmbrelHostEnvironment
	modelNumber?: string
	serialNumber?: string
}) => {
	const iconDimensions = {
		'umbrel-home': 128,
		'raspberry-pi': 64,
		'docker-container': 72,
		unknown: 128,
	}

	if (environment === 'umbrel-home') {
		return <AnimatedUmbrelHomeIcon modelNumber={modelNumber} serialNumber={serialNumber} />
	}

	const icon =
		environment && hostEnvironmentMap[environment]?.icon ? (
			<FadeInImg
				src={hostEnvironmentMap[environment].icon}
				width={iconDimensions[environment]}
				height={iconDimensions[environment]}
			/>
		) : (
			<TbQuestionMark className='h-12 w-12 text-white/50' />
		)

	// Only wrap in IconContainer for raspberry-pi and docker-container
	if (environment === 'raspberry-pi' || environment === 'docker-container') {
		return <IconContainer>{icon}</IconContainer>
	}

	return icon
}

const IconContainer = ({children}: {children: React.ReactNode}) => (
	<div
		className='grid h-32 w-32 place-items-center rounded-[27px] bg-[#52525252]'
		style={{
			boxShadow: '0 1px 2px #ffffff55 inset',
		}}
	>
		{children}
	</div>
)
