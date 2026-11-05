import {motion, useReducedMotion} from 'motion/react'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Link} from 'react-router-dom'

import {UmbrelLogoDraw} from '@/components/umbrel-logo-draw'
import {useDeviceInfo} from '@/hooks/use-device-info'
import {useLanguage} from '@/hooks/use-language'
import {footerClass, primaryButtonProps, SubTitle, Title} from '@/layouts/bare/shared'
import {cn} from '@/lib/utils'
import {OnboardingAction, OnboardingFooter} from '@/routes/onboarding/onboarding-footer'
import {useOnboardingDevice} from '@/routes/onboarding/use-onboarding-device'
import {trpcReact} from '@/trpc/trpc'
import {matchBrowserLanguage} from '@/utils/language'

// Attempt to auto-select a suitable language from the user's browser preferences
function useAutoDetectLanguage() {
	const [, setLang] = useLanguage()

	useEffect(() => {
		// Only run once
		if (sessionStorage.getItem('temporary-language')) {
			return
		}

		// Get the browser language codes (eg. ['en-US', 'jp'])
		const {languages: browserLanguageCodes} = navigator
		if (!Array.isArray(browserLanguageCodes)) return

		// If we support one of them, set it
		const languageCode = matchBrowserLanguage(browserLanguageCodes)
		if (languageCode) {
			setLang(languageCode)
			sessionStorage.setItem('temporary-language', languageCode)
		}
	}, [])
}

const ENTRANCE_EASE = [0.16, 1, 0.3, 1] as const

// The mark starts drawing once the card from OnboardingPage has mostly settled
// (its entrance runs from 0.5s to 1.9s).
const LOGO_DELAY = 0.7

// This is the one bare page with its own choreography, so it composes the shared
// primitives directly instead of going through Layout: the card arrives empty,
// the mark draws itself, and only then does everything else rise in. The reveal
// is keyed off the draw's onComplete rather than absolute delays, so the two can
// never drift apart.
export default function OnboardingStart() {
	const {t} = useTranslation()
	const continueLinkRef = useRef<HTMLAnchorElement>(null)
	const device = useOnboardingDevice()
	const reduceMotion = useReducedMotion()
	const [drawn, setDrawn] = useState(false)

	// A Raspberry Pi with an external drive attached first gets asked where its
	// data should live (see external-drive.tsx); everyone else goes to the form
	const {data: deviceInfo} = useDeviceInfo()
	const isRaspberryPi = deviceInfo?.umbrelHostEnvironment === 'raspberry-pi'
	const externalDevicesQ = trpcReact.files.externalDevices.useQuery(undefined, {enabled: isRaspberryPi})
	const hasExternalDrive = isRaspberryPi && (externalDevicesQ.data?.length ?? 0) > 0
	const nextStep = hasExternalDrive ? '/onboarding/external-drive' : '/onboarding/create-account'

	// Auto detect browser language once to set the default language
	useAutoDetectLanguage()

	// Focus only once the content is actually visible, so Enter can't submit an
	// invisible button during the logo draw
	useEffect(() => {
		if (drawn) continueLinkRef.current?.focus()
	}, [drawn])

	// Reduced motion collapses the whole sequence: the mark renders finished,
	// onComplete fires immediately, and everything appears in place.
	const dur = (seconds: number) => (reduceMotion ? 0 : seconds)

	// Umbrel Pro and Home have artwork of their own, so the drawn mark hands over
	// to it: the two share a grid cell and cross-dissolve without the layout moving.
	const handOffToArtwork = device.showDevice && !!device.image

	const stagger = {
		hidden: {},
		show: {transition: {delayChildren: dur(0.15), staggerChildren: dur(0.12)}},
	}
	const item = {
		hidden: {opacity: 0, y: 12},
		show: {opacity: 1, y: 0, transition: {duration: dur(1.1), ease: ENTRANCE_EASE}},
	}

	return (
		<>
			<div className='flex-1' />
			{/* mt keeps a minimum gap from the card's top edge when the spacers collapse */}
			<motion.div
				className={cn('mt-5 flex w-full flex-col items-center gap-5', !drawn && 'pointer-events-none')}
				variants={stagger}
				initial={reduceMotion ? false : 'hidden'}
				animate={drawn ? 'show' : 'hidden'}
			>
				<div className='grid place-items-center'>
					<motion.div
						className='col-start-1 row-start-1'
						style={{viewTransitionName: 'umbrel-logo'}}
						animate={drawn && handOffToArtwork ? {opacity: 0, scale: 0.85} : {opacity: 1, scale: 1}}
						transition={{duration: dur(0.5), delay: dur(0.15), ease: ENTRANCE_EASE}}
					>
						<UmbrelLogoDraw
							className='w-[100px]'
							delay={reduceMotion ? 0 : LOGO_DELAY}
							onComplete={() => setDrawn(true)}
						/>
					</motion.div>
					{handOffToArtwork && (
						<motion.div variants={item} className='col-start-1 row-start-1 flex flex-col items-center gap-1'>
							<img src={device.image!} alt='' className={device.imageClassName} />
							<p className='text-[13px] font-medium text-white/30'>{device.name}</p>
						</motion.div>
					)}
				</div>

				<motion.div variants={item} className='flex flex-col items-center gap-1.5'>
					<Title>{t('onboarding.start.title')}</Title>
					<SubTitle style={{maxWidth: 500}}>{t('onboarding.start.subtitle')}</SubTitle>
				</motion.div>

				<motion.div variants={item}>
					<Link to={nextStep} viewTransition ref={continueLinkRef} {...primaryButtonProps}>
						{t('onboarding.start.continue')}
					</Link>
				</motion.div>
			</motion.div>
			<div className='flex-1' />
			<motion.div
				className={cn(footerClass, 'mt-5', !drawn && 'pointer-events-none')}
				initial={reduceMotion ? false : {opacity: 0, y: 10}}
				animate={drawn ? {opacity: 1, y: 0} : {opacity: 0, y: 10}}
				transition={{duration: dur(1), delay: dur(0.85), ease: ENTRANCE_EASE}}
			>
				<OnboardingFooter action={OnboardingAction.RESTORE} />
			</motion.div>
		</>
	)
}
