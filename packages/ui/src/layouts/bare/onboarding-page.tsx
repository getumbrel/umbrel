import {motion} from 'motion/react'
import {useLocation} from 'react-router-dom'

import {OnboardingBackground} from '@/components/onboarding-background'

export function OnboardingPage({children}: {children: React.ReactNode}) {
	const location = useLocation()

	// First arrival: the card settles in gently (fade + slight grow); the
	// content inside then follows in sequence (see Layout's `animate`).
	const shouldAnimate = location.pathname === '/onboarding'
	const cardProps = shouldAnimate
		? ({
				initial: {opacity: 0, scale: 0.96},
				animate: {opacity: 1, scale: 1},
				transition: {
					duration: 1.4,
					delay: 0.5,
					ease: [0.16, 1, 0.3, 1],
				},
			} as const)
		: ({} as const)

	return (
		<>
			<OnboardingBackground />
			{/* The p-5 gutter keeps the card floating at every size: it never goes
			    full-bleed, holding a 20px inset (so max width/height is viewport - 40px) */}
			<div className='relative flex h-svh items-center justify-center p-5'>
				{/* System material (same recipe as modals/toasts): tinted backdrop blur,
				    0.5px edge, inset shine, soft drop shadow. The modal radius is 24px. */}
				<motion.div
					className='umbrel-material flex max-h-[calc(100svh-40px)] min-h-[calc(100svh-40px)] w-full max-w-[1000px] flex-col overflow-y-auto overscroll-contain rounded-3xl p-4 md:max-h-[min(850px,calc(100svh-40px))] md:min-h-[min(700px,calc(100svh-40px))] md:p-6'
					// Heavier blur than the default 20px: this card is large and sits directly on the video
					style={{viewTransitionName: 'onboarding-card', '--material-blur': '40px'} as React.CSSProperties}
					{...cardProps}
				>
					{children}
				</motion.div>
			</div>
		</>
	)
}
