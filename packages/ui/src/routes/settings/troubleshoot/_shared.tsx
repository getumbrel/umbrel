import {format} from 'date-fns'
import {saveAs} from 'file-saver'
import filenamify from 'filenamify/browser'
import {useEffect, useRef} from 'react'

import {BackLink} from '@/modules/immersive-picker'
import {cn} from '@/shadcn-lib/utils'
import {RouterInput} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export type SystemLogType = RouterInput['system']['logs']['type']

export function TroubleshootTitleBackLink() {
	return <BackLink to='/settings/troubleshoot'>{t('troubleshoot')}</BackLink>
}

export const downloadUtf8Logs = (contents: string, fileNameString?: string) => {
	const blob = new Blob([contents], {type: 'text/plain;charset=utf-8'})

	// Separating sections with `_` so easier to machine-parse in the future
	const name = ['umbrel', filenamify(fileNameString ?? 'logs'), format(new Date(), 'yyyy-MM-dd_HH-mm')].join('_')

	// Final pass: replacing strings and doing lowercase so good for urls too?
	const finalName = name.replace(/\s+/g, '-').toLocaleLowerCase()

	saveAs(blob, finalName + '.log')
}

export function useScrollToBottom(ref: React.RefObject<HTMLDivElement>, deps: any[]) {
	useEffect(() => {
		setTimeout(() => {
			if (!ref.current) return
			ref.current.scrollTop = ref.current.scrollHeight + 100
		}, 300)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ref, ...deps])
}

export function LogResults({children}: {children: string}) {
	const ref = useRef<HTMLDivElement>(null)
	useScrollToBottom(ref, [children])

	return (
		<div ref={ref} className='w-full flex-1 overflow-auto rounded-10 bg-black px-5 py-4'>
			<div
				key={children}
				className={cn(
					'whitespace-pre font-mono text-xs text-white/50',
					children && 'delay-500 animate-in fade-in fill-mode-both',
				)}
			>
				{children}
			</div>
			{/* Keeps scroll pinned to bottom */}
			<div style={{overflowAnchor: 'auto'}} />
		</div>
	)
}
