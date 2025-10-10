import {AnimatePresence, motion} from 'framer-motion'
import {ChevronDown, ChevronUp} from 'lucide-react'
import {useState} from 'react'
import {Trans} from 'react-i18next/TransWithoutContext'
import {FaPlus} from 'react-icons/fa6'

import networkIcon from '@/features/files/assets/network-icon.png'
import {InlineCopyableField} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/inline-copyable-field'
import {
	InstructionContainer,
	InstructionItem,
} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/instruction'
import {t} from '@/utils/i18n'

interface Props {
	username: string
	password: string
	sharename?: string
}

export function UmbrelOSInstructions({username, password, sharename}: Props) {
	const [showBackup, setShowBackup] = useState(false)
	return (
		<div className='space-y-4'>
			<InstructionContainer>
				<InstructionItem>
					<Trans
						i18nKey='files-share.instructions.umbrelos.open-and-click'
						components={{
							plus: <FaPlus className='inline-block size-3 align-middle' />,
							deviceIcon: <img src={networkIcon} alt='' className='inline-block h-4 w-auto align-middle' />,
						}}
						values={{deviceLabel: t('files-sidebar.network-sidebar')}}
					/>
				</InstructionItem>
				<InstructionItem>
					<Trans i18nKey='files-share.instructions.umbrelos.select-device' />
					{sharename ? (
						<div className='mt-1 text-[11px] text-white/60'>
							<Trans i18nKey='files-share.instructions.umbrelos.cant-find-note' />
						</div>
					) : null}
				</InstructionItem>
				<InstructionItem>
					<Trans
						i18nKey='files-share.instructions.umbrelos.enter-username'
						components={{field: <InlineCopyableField value={username} />}}
					/>
				</InstructionItem>
				<InstructionItem>
					<Trans
						i18nKey='files-share.instructions.umbrelos.enter-password'
						components={{field: <InlineCopyableField value={password} />}}
					/>
				</InstructionItem>
				{sharename ? (
					<InstructionItem>
						<Trans i18nKey='files-share.instructions.umbrelos.select-sharename' values={{sharename}} />
					</InstructionItem>
				) : null}
			</InstructionContainer>

			<button
				onClick={() => setShowBackup(!showBackup)}
				className='flex w-full items-center justify-between text-xs font-medium text-brand-lightest transition-opacity duration-300 hover:opacity-80'
			>
				<Trans i18nKey='files-share.instructions.umbrelos.backup.title' />
				{showBackup ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
			</button>

			<AnimatePresence>
				{showBackup && (
					<motion.div
						initial={{height: 0, opacity: 0}}
						animate={{height: 'auto', opacity: 1}}
						exit={{height: 0, opacity: 0}}
						transition={{duration: 0.3}}
						className='overflow-hidden'
					>
						<InstructionContainer>
							<InstructionItem>
								<Trans
									i18nKey='files-share.instructions.umbrelos.backup.follow-then-go-to'
									values={{settings: t('settings'), backups: t('backups')}}
								/>
							</InstructionItem>
							<InstructionItem>
								<Trans
									i18nKey='files-share.instructions.umbrelos.backup.select-add'
									values={{addUmbrelOrNas: t('backups-add-umbrel-or-nas', {defaultValue: 'Add Umbrel or NAS'})}}
								/>
							</InstructionItem>
							<InstructionItem>
								<Trans i18nKey='files-share.instructions.umbrelos.backup.select-connected' />
							</InstructionItem>
							<InstructionItem>
								<Trans i18nKey='files-share.instructions.umbrelos.backup.follow-onscreen' />
							</InstructionItem>
						</InstructionContainer>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	)
}
