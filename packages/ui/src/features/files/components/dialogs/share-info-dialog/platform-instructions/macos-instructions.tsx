import {ChevronDown, ChevronUp} from 'lucide-react'
import {AnimatePresence, motion} from 'motion/react'
import {useState} from 'react'
import {Trans, useTranslation} from 'react-i18next'
import {IoLogoApple} from 'react-icons/io5'

import {Button} from '@/components/ui/button'
import {InlineCopyableField} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/inline-copyable-field'
import {
	InstructionContainer,
	InstructionItem,
} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/instruction'

interface MacOSInstructionsProps {
	smbUrl: string
	username: string
	password: string
	name: string
}

export function MacOSInstructions({smbUrl, username, password, name}: MacOSInstructionsProps) {
	const {t} = useTranslation()
	const [showTimeMachine, setShowTimeMachine] = useState(false)

	return (
		<div className='space-y-4'>
			<div className='overflow-hidden rounded-12 border border-white/10 bg-white/6 p-4'>
				<h4 className='text-14 font-semibold -tracking-2'>{t('files-share.instructions.macos.app-title')}</h4>
				<div className='mt-2 flex min-h-[120px] gap-4'>
					<div className='min-w-0 flex-1'>
						<p className='text-12 leading-relaxed text-white/60'>
							{t('files-share.instructions.macos.app-description')}
						</p>
						<Button asChild variant='default' size='sm' className='mt-3 gap-1.5 text-11'>
							<a href='https://link.umbrel.com/macos-app' target='_blank' rel='noopener noreferrer'>
								<IoLogoApple className='size-3' />
								{t('files-share.instructions.macos.app-download')}
							</a>
						</Button>
					</div>
					<div
						aria-hidden
						className='pointer-events-none relative -mr-4 -mb-4 w-[140px] max-w-[40%] shrink-0 self-stretch select-none'
					>
						<img
							src='/assets/desktop/finder-preview.svg'
							alt=''
							className='absolute top-1 left-0 w-[240px] max-w-none'
							draggable={false}
						/>
					</div>
				</div>
			</div>

			<div className='space-y-2'>
				<h4 className='px-1 text-12 font-medium text-white/50'>{t('files-share.instructions.macos.manual-heading')}</h4>
				<InstructionContainer>
					<InstructionItem>{t('files-share.instructions.macos.open-finder')}</InstructionItem>
					<InstructionItem>
						<Trans
							t={t}
							i18nKey='files-share.instructions.macos.enter-url'
							values={{smbUrl}}
							tOptions={{interpolation: {escapeValue: true}}}
							shouldUnescape
							components={{
								field: <InlineCopyableField value={smbUrl} />,
							}}
						/>
					</InstructionItem>
					<InstructionItem>{t('files-share.instructions.macos.select-registered')}</InstructionItem>
					<InstructionItem>
						<Trans
							t={t}
							i18nKey='files-share.instructions.macos.enter-username'
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
							i18nKey='files-share.instructions.macos.enter-password'
							values={{password}}
							tOptions={{interpolation: {escapeValue: true}}}
							shouldUnescape
							components={{
								field: <InlineCopyableField value={password} />,
							}}
						/>
					</InstructionItem>
					<InstructionItem>{t('files-share.instructions.macos.click-connect')}</InstructionItem>
				</InstructionContainer>
			</div>

			<button
				onClick={() => setShowTimeMachine(!showTimeMachine)}
				className='flex w-full items-center justify-between text-xs font-medium text-brand-lightest transition-opacity duration-300 hover:opacity-80'
			>
				{t('files-share.instructions.macos.time-machine')}
				{showTimeMachine ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
			</button>

			<AnimatePresence>
				{showTimeMachine && (
					<motion.div
						initial={{height: 0, opacity: 0}}
						animate={{height: 'auto', opacity: 1}}
						exit={{height: 0, opacity: 0}}
						transition={{duration: 0.3}}
						className='overflow-hidden'
					>
						<InstructionContainer>
							<InstructionItem>{t('files-share.instructions.macos.time-machine.follow-steps')}</InstructionItem>
							<InstructionItem>{t('files-share.instructions.macos.time-machine.go-settings')}</InstructionItem>
							<InstructionItem>{t('files-share.instructions.macos.time-machine.select-disk', {name})}</InstructionItem>
							<InstructionItem>{t('files-share.instructions.macos.time-machine.choose-encryption')}</InstructionItem>
							<InstructionItem>{t('files-share.instructions.macos.time-machine.disk-limit')}</InstructionItem>
						</InstructionContainer>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	)
}
