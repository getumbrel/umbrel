import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {links} from '@/constants/links'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {DriveIcon, SdCard} from '@/features/storage/components/drive-visuals'
import {useDeviceInfo} from '@/hooks/use-device-info'
import {Layout, primaryButtonProps, secondaryButtonClasss} from '@/layouts/bare/shared'
import {cn} from '@/lib/utils'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {OnboardingAction, OnboardingFooter} from '@/routes/onboarding/onboarding-footer'
import {RecommendedBadge} from '@/routes/onboarding/recommended-badge'
import {trpcReact} from '@/trpc/trpc'

// Raspberry Pi with an external drive attached: umbrelOS keeps its data on the
// medium it booted from (the SD card), which is rarely what someone who just
// plugged in an SSD expects. Instead of warning them after they've filled in
// the account form, this step asks up front where their data should live and,
// if they pick the drive, walks them through installing umbrelOS on it.

const RECOMMEND_DRIVE_MIN_BYTES = 250_000_000_000

// USB thumb drives make poor system disks; only recommend drives that look like
// real SSDs (by name) or are large enough to plausibly be one
function isDriveRecommended(drive: {name: string; size: number}) {
	return /\b(ssd|nvme)\b/i.test(drive.name) || drive.size >= RECOMMEND_DRIVE_MIN_BYTES
}

export default function ExternalDriveChoice() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const {shutdown} = useGlobalSystemState()
	const {data: deviceInfo, isLoading: isDeviceInfoLoading} = useDeviceInfo()
	const isRaspberryPi = deviceInfo?.umbrelHostEnvironment === 'raspberry-pi'
	const externalDevicesQ = trpcReact.files.externalDevices.useQuery(undefined, {enabled: isRaspberryPi})
	const drive = externalDevicesQ.data?.[0]

	const [view, setView] = useState<'choose' | 'steps'>('choose')

	// This step only applies to a Pi with a drive attached; anything else goes
	// straight to the account form
	useEffect(() => {
		if (isDeviceInfoLoading) return
		if (!isRaspberryPi || (externalDevicesQ.isFetched && !drive)) {
			navigate('/onboarding/create-account', {replace: true})
		}
	}, [isDeviceInfoLoading, isRaspberryPi, externalDevicesQ.isFetched, drive, navigate])

	if (!drive) return null

	const driveName = drive.name
	const driveSize = formatFilesystemSize(drive.size)
	const continueWithSdCard = () => navigate('/onboarding/create-account', {state: {externalDriveAcknowledged: true}})

	if (view === 'steps') {
		const steps = [
			t('onboarding.external-drive.steps.shutdown'),
			t('onboarding.external-drive.steps.install', {drive: driveName}),
			t('onboarding.external-drive.steps.boot', {drive: driveName}),
		]
		return (
			<Layout
				title={t('onboarding.external-drive.steps.title', {drive: driveName})}
				// Drive names run long; keep this heading a size down from the rest of onboarding
				titleClassName='sm:text-24'
				subTitle=''
				subTitleMaxWidth={630}
				showLogo={false}
				footer={<OnboardingFooter action={OnboardingAction.RESTORE} />}
			>
				<div className='mx-auto mt-2 w-full max-w-[560px]'>
					<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
						{steps.map((text, i) => (
							// flex-wrap + min-w on the text: on narrow screens the download
							// button drops to its own line instead of squeezing the step text
							<div key={i} className='flex flex-wrap items-center gap-3 p-3 text-13 font-medium -tracking-3'>
								<div className='flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-11 text-white/60'>
									{i + 1}
								</div>
								<div className='min-w-[200px] flex-1 text-white/70'>{text}</div>
								{i === 1 && (
									<a
										href={links.umbrelOS}
										target='_blank'
										rel='noreferrer'
										// Hidden on mobile: the step happens on a computer, so the download belongs there
										className='ml-auto hidden shrink-0 rounded-full bg-white/10 px-3 py-1 text-12 text-white/80 transition-colors hover:bg-white/15 md:block'
									>
										{t('onboarding.external-drive.steps.download')}
									</a>
								)}
							</div>
						))}
					</div>

					<div className='flex flex-col-reverse items-center justify-center gap-3 pt-6 md:flex-row'>
						<button className={secondaryButtonClasss} onClick={() => setView('choose')}>
							{t('back')}
						</button>
						<button {...primaryButtonProps} onClick={() => shutdown()}>
							{t('shut-down')}
						</button>
					</div>
				</div>
			</Layout>
		)
	}

	return (
		<Layout
			title={t('onboarding.external-drive.title')}
			subTitle={t('onboarding.external-drive.subtitle')}
			subTitleMaxWidth={630}
			footer={<OnboardingFooter action={OnboardingAction.RESTORE} />}
		>
			<div className='mx-auto mt-2 grid w-full max-w-[720px] gap-3 md:grid-cols-2'>
				<ChoiceCard
					onClick={continueWithSdCard}
					visual={<SdCard />}
					title={t('onboarding.external-drive.sd-card')}
					description={t('onboarding.external-drive.sd-card.description', {drive: driveName})}
				/>
				{/* The enclosure is sized up here so it stands level with the SD card next to it */}
				<ChoiceCard
					onClick={() => setView('steps')}
					visual={<DriveIcon className='h-12 w-[52px]' />}
					title={`${driveSize} ${driveName}`}
					recommended={isDriveRecommended(drive)}
					description={t('onboarding.external-drive.drive.description')}
				/>
			</div>
		</Layout>
	)
}

function ChoiceCard({
	onClick,
	visual,
	title,
	recommended,
	description,
}: {
	onClick: () => void
	visual: React.ReactNode
	title: string
	recommended?: boolean
	description: string
}) {
	return (
		<button
			type='button'
			onClick={onClick}
			className={cn(
				'flex flex-col items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-5 text-left transition-colors duration-300',
				'hover:border-white/20 hover:bg-white/8 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-white/40',
			)}
		>
			<div className='flex w-full items-start justify-between gap-3'>
				{visual}
				{recommended && <RecommendedBadge className='shrink-0' />}
			</div>
			<div className='flex flex-col gap-1'>
				<span className='text-15 font-semibold text-white/90'>{title}</span>
				<span className='text-13 leading-relaxed text-white/50'>{description}</span>
			</div>
		</button>
	)
}
