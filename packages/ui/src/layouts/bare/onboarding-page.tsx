import {motion} from 'framer-motion'
import {useLocation} from 'react-router-dom'

import {OnboardingBackground} from '@/components/onboarding-background'

export function OnboardingPage({children}: {children: React.ReactNode}) {
	const location = useLocation()

	const animate = location.pathname === '/onboarding'
	const cardProps = animate
		? {
				initial: {opacity: 0, scale: 1.15},
				animate: {opacity: 1, scale: 1},
				transition: {
					duration: 2.5,
					delay: 1.5,
					ease: [0.16, 1, 0.3, 1],
				},
			}
		: {}

	return (
		<>
			<OnboardingBackground />
			<div className='relative flex min-h-dvh items-center justify-center p-0 md:p-5'>
				<motion.div
					className='flex min-h-dvh w-full max-w-none flex-col rounded-none bg-[#1E1E1E]/20 p-3 backdrop-blur-2xl md:max-h-[850px] md:min-h-[700px] md:max-w-[1000px] md:rounded-3xl md:bg-[#1E1E1E]/70 md:p-6'
					style={{
						boxShadow: '0px 24px 48px 0px #000000A3, inset 1px 1px 1px 0px #FFFFFF1F',
						viewTransitionName: 'onboarding-card',
					}}
					{...cardProps}
				>
					{children}
				</motion.div>
			</div>
		</>
	)
}
