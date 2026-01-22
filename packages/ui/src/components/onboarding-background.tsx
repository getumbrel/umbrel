import {useOnboardingDevice} from '@/routes/onboarding/use-onboarding-device'
import {cn} from '@/shadcn-lib/utils'

const backgroundClass = 'pointer-events-none fixed inset-0 size-full object-cover object-center'

export function OnboardingBackground({className}: {className?: string}) {
	const {showDevice} = useOnboardingDevice()

	// Pro/Home: Video (webm) with poster (jpg) fallback for older browsers
	// Uses pre-rendered ping-pong video (forward + reversed) for seamless infinite loop
	if (showDevice) {
		return (
			<video
				autoPlay
				loop
				muted
				playsInline
				poster='/wallpapers/22.jpg'
				src='/onboarding/onboarding-bg.webm'
				className={cn(backgroundClass, className)}
			/>
		)
	}

	// Other devices: Static wallpaper
	return <img src='/wallpapers/18.jpg' alt='' className={cn(backgroundClass, className)} />
}
