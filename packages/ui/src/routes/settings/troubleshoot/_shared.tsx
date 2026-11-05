import {format} from 'date-fns'
import {saveAs} from 'file-saver'
import filenamify from 'filenamify/browser'
import {useEffect, useRef} from 'react'
import {useTranslation} from 'react-i18next'

import {cn} from '@/lib/utils'
import {BackLink} from '@/modules/immersive-picker'
import {usePickerTarget} from '@/modules/immersive-picker/target'
import {RouterInput} from '@/trpc/trpc'

export type SystemLogType = RouterInput['system']['logs']['type']

export function TroubleshootTitleBackLink() {
	const {t} = useTranslation()
	const {linkToTarget} = usePickerTarget('troubleshoot')
	return <BackLink to={linkToTarget({type: 'picker'})}>{t('troubleshoot')}</BackLink>
}

export const downloadUtf8Logs = (contents: string, fileNameString?: string) => {
	const blob = new Blob([contents], {type: 'text/plain;charset=utf-8'})

	// Separating sections with `_` so easier to machine-parse in the future
	const name = ['umbrel', filenamify(fileNameString ?? 'logs'), format(new Date(), 'yyyy-MM-dd_HH-mm')].join('_')

	// Final pass: replacing strings and doing lowercase so good for urls too?
	const finalName = name.replace(/\s+/g, '-').toLocaleLowerCase()

	saveAs(blob, finalName + '.log')
}

export function useScrollToBottom(ref: React.RefObject<HTMLDivElement | null>, deps: any[]) {
	useEffect(() => {
		const timeout = setTimeout(() => {
			if (!ref.current) return
			// Don't move the logs while the user is selecting text to copy.
			const selection = window.getSelection()
			if (selection && !selection.isCollapsed && selection.containsNode(ref.current, true)) return
			ref.current.scrollTop = ref.current.scrollHeight + 100
		}, 300)
		return () => clearTimeout(timeout)
	}, [ref, ...deps])
}

export function LogResults({children}: {children: string}) {
	const ref = useRef<HTMLDivElement>(null)
	useScrollToBottom(ref, [children])

	return (
		<div
			ref={ref}
			data-native-context-menu
			className='umbrel-stable-gutter w-full flex-1 overflow-auto rounded-10 bg-black px-5 py-4'
		>
			{/* Allow text selection for copying logs/errors */}
			<div
				className={cn(
					'font-mono text-xs whitespace-pre text-white/50 select-text',
					children && 'animate-in delay-500 fill-mode-both fade-in',
				)}
			>
				{children}
			</div>
			{/* Keeps scroll pinned to bottom */}
			<div style={{overflowAnchor: 'auto'}} />
		</div>
	)
}
