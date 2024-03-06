import {ReactNode} from 'react'

import {UNKNOWN} from '@/constants'
import {useIsMobile, useIsSmallMobile} from '@/hooks/use-is-mobile'
import {Button} from '@/shadcn-components/ui/button'
import {cmdOrCtrl, fixmeHandler, IS_ANDROID, platform} from '@/utils/misc'

export default function MiscStory() {
	const isMobile = useIsMobile()
	const isSmallMobile = useIsSmallMobile()

	return (
		<dl className='mx-auto grid w-full max-w-lg grid-cols-2 gap-3 bg-white/6 p-4'>
			<Key>Platform</Key>
			<Value>{platform()}</Value>
			<Key>Unkown string</Key>
			<Value>{UNKNOWN()}</Value>
			<Key>
				<code>cmdOrCtrl()</code>
			</Key>
			<Value>{cmdOrCtrl()}</Value>
			<Key>
				<code>fixmeHandler()</code>
			</Key>
			<Value>
				<Button onClick={fixmeHandler}>Click Me</Button>
			</Value>
			<Key>
				<code>isMobile()</code>
			</Key>
			<Value>{isMobile ? 'true' : 'false'}</Value>
			<Key>
				<code>isSmallMobile()</code>
			</Key>
			<Value>{isSmallMobile ? 'true' : 'false'}</Value>
			<Key>
				<code>IS_ANDROID</code>
			</Key>
			<Value>{IS_ANDROID ? 'true' : 'false'}</Value>
			{/* TODO: put language dir and maybe media query */}
		</dl>
	)
}

function Key({children}: {children: ReactNode}) {
	return <dt className='font-bold'>{children}</dt>
}

function Value({children}: {children: ReactNode}) {
	return <dd className=''>{children}</dd>
}
