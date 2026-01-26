import {useDeviceInfo} from '@/hooks/use-device-info'
import {useOnboardingDevice} from '@/routes/onboarding/use-onboarding-device'
import {cn} from '@/shadcn-lib/utils'

const backgroundClass = 'pointer-events-none fixed inset-0 size-full object-cover object-center'

export function OnboardingBackground({className}: {className?: string}) {
	const {isLoading} = useDeviceInfo()
	const {showDevice} = useOnboardingDevice()

	// Show black while loading to prevent wallpaper 18 flash on Pro/Home devices
	if (isLoading) {
		return <div className={cn(backgroundClass, 'bg-black', className)} />
	}

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
