import {Trans, useTranslation} from 'react-i18next'

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
		<InstructionContainer>
			<InstructionItem>{t('files-share.instructions.windows.open-run')}</InstructionItem>
			<InstructionItem>
				<Trans
					t={t}
					i18nKey='files-share.instructions.windows.enter-url'
					values={{smbUrl}}
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
					components={{
						field: <InlineCopyableField value={password} />,
					}}
				/>
			</InstructionItem>
			<InstructionItem>{t('files-share.instructions.windows.remember-credentials')}</InstructionItem>
		</InstructionContainer>
	)
}
