import React from 'react'

export function IframeChecker({children}: {children: React.ReactNode}) {
	const isIframe = window.self !== window.top

	if (isIframe) {
		return <div className='grid h-screen w-full place-items-center'>umbrelOS cannot be embedded in an iframe.</div>
	}
	return <>{children}</>
}
