import {AnimatePresence, motion} from 'framer-motion'
import {ChevronDown, ChevronUp} from 'lucide-react'
import {useState} from 'react'
import {Trans} from 'react-i18next/TransWithoutContext'

import {InlineCopyableField} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/inline-copyable-field'
import {
	InstructionContainer,
	InstructionItem,
} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/instruction'
import {t} from '@/utils/i18n'

interface MacOSInstructionsProps {
	smbUrl: string
	username: string
	password: string
	name: string
}

export function MacOSInstructions({smbUrl, username, password, name}: MacOSInstructionsProps) {
	const [showTimeMachine, setShowTimeMachine] = useState(false)

	return (
		<div className='space-y-4'>
			<InstructionContainer>
				<InstructionItem>{t('files-share.instructions.macos.open-finder')}</InstructionItem>
				<InstructionItem>
					<Trans
						i18nKey='files-share.instructions.macos.enter-url'
						values={{smbUrl}}
						components={{
							field: <InlineCopyableField value={smbUrl} />,
						}}
					/>
				</InstructionItem>
				<InstructionItem>{t('files-share.instructions.macos.select-registered')}</InstructionItem>
				<InstructionItem>
					<Trans
						i18nKey='files-share.instructions.macos.enter-username'
						values={{username}}
						components={{
							field: <InlineCopyableField value={username} />,
						}}
					/>
				</InstructionItem>
				<InstructionItem>
					<Trans
						i18nKey='files-share.instructions.macos.enter-password'
						values={{password}}
						components={{
							field: <InlineCopyableField value={password} />,
						}}
					/>
				</InstructionItem>
				<InstructionItem>{t('files-share.instructions.macos.click-connect')}</InstructionItem>
			</InstructionContainer>

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
