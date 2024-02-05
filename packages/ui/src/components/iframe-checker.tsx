import React from 'react'

export function IframeChecker({children}: {children: React.ReactNode}) {
	const isIframe = window.self !== window.top

	if (isIframe) {
		return <div className='grid h-screen w-full place-items-center'>Not allowed in iframe.</div>
	}
	return <>{children}</>
}
