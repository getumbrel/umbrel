import {Trans, useTranslation} from 'react-i18next'
import {IoLogoWindows} from 'react-icons/io5'

import {Button} from '@/components/ui/button'
import {InlineCopyableField} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/inline-copyable-field'
import {
	InstructionContainer,
	InstructionItem,
} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/instruction'

interface WindowsInstructionsProps {
	smbUrl: string
	username: string
	password: string
}

export function WindowsInstructions({smbUrl, username, password}: WindowsInstructionsProps) {
	const {t} = useTranslation()
	return (
		<div className='space-y-4'>
			<div className='overflow-hidden rounded-12 border border-white/10 bg-white/6 p-4'>
				<h4 className='text-14 font-semibold -tracking-2'>{t('files-share.instructions.windows.app-title')}</h4>
				<div className='mt-2 flex min-h-[120px] gap-4'>
					<div className='min-w-0 flex-1'>
						<p className='text-12 leading-relaxed text-white/60'>
							{t('files-share.instructions.windows.app-description')}
						</p>
						<Button asChild variant='default' size='sm' className='mt-3 gap-1.5 text-11'>
							<a href='https://link.umbrel.com/windows-app' target='_blank' rel='noopener noreferrer'>
								<IoLogoWindows className='size-3' />
								{t('files-share.instructions.windows.app-download')}
							</a>
						</Button>
					</div>
					<div
						aria-hidden
						className='pointer-events-none relative -mr-4 -mb-4 w-[140px] max-w-[40%] shrink-0 self-stretch select-none'
					>
						<img
							src='/assets/desktop/explorer-preview.svg'
							alt=''
							className='absolute top-1 left-0 w-[240px] max-w-none'
							draggable={false}
						/>
					</div>
				</div>
			</div>

			<div className='space-y-2'>
				<h4 className='px-1 text-12 font-medium text-white/50'>
					{t('files-share.instructions.windows.manual-heading')}
				</h4>
				<InstructionContainer>
					<InstructionItem>{t('files-share.instructions.windows.open-run')}</InstructionItem>
					<InstructionItem>
						<Trans
							t={t}
							i18nKey='files-share.instructions.windows.enter-url'
							values={{smbUrl}}
							tOptions={{interpolation: {escapeValue: true}}}
							shouldUnescape
							components={{
								field: <InlineCopyableField value={smbUrl} />,
							}}
						/>
					</InstructionItem>
					<InstructionItem>
						<Trans
							t={t}
							i18nKey='files-share.instructions.windows.enter-username'
							values={{username}}
							tOptions={{interpolation: {escapeValue: true}}}
							shouldUnescape
							components={{
								field: <InlineCopyableField value={username} />,
							}}
						/>
					</InstructionItem>
					<InstructionItem>
						<Trans
							t={t}
							i18nKey='files-share.instructions.windows.enter-password'
							values={{password}}
							tOptions={{interpolation: {escapeValue: true}}}
							shouldUnescape
							components={{
								field: <InlineCopyableField value={password} />,
							}}
						/>
					</InstructionItem>
					<InstructionItem>{t('files-share.instructions.windows.remember-credentials')}</InstructionItem>
				</InstructionContainer>
			</div>
		</div>
	)
}
