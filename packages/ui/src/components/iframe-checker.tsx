import React from 'react'

import {CoverMessage} from './ui/cover-message'

export function IframeChecker({children}: {children: React.ReactNode}) {
	const isIframe = window.self !== window.top
	if (isIframe) {
		return <CoverMessage>Not allowed in iframe</CoverMessage>
	}
	return <>{children}</>
}
