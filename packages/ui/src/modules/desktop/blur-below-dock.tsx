export const BlurBelowDock = () => (
	// Using 200px because we don't want to intersect the app icons
	<div
		className='pointer-events-none fixed inset-0 top-0 backdrop-blur-2xl duration-500 animate-in fade-in fill-mode-both'
		style={{
			background: '#00000044',
			WebkitMaskImage: 'linear-gradient(transparent calc(100% - 200px), black calc(100% - 30px))',
		}}
	/>
)
