/** Covers entire screen to show a message */
export function CoverMessage({children}: {children: React.ReactNode}) {
	return (
		<div className='fixed inset-0 z-50 flex flex-col items-center justify-center gap-1 bg-black/80'>{children}</div>
	)
}
