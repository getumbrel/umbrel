import {Trans, useTranslation} from 'react-i18next'

import {InlineCopyableField} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/inline-copyable-field'
import {
	InstructionContainer,
	InstructionItem,
} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/instruction'

interface IOSInstructionsProps {
	smbUrl: string
	username: string
	password: string
}

export function IOSInstructions({smbUrl, username, password}: IOSInstructionsProps) {
	const {t} = useTranslation()
	return (
		<InstructionContainer>
			<InstructionItem>{t('files-share.instructions.ios.install-files')}</InstructionItem>
			<InstructionItem>{t('files-share.instructions.ios.tap-dots')}</InstructionItem>
			<InstructionItem>
				<Trans
					t={t}
					i18nKey='files-share.instructions.ios.enter-server'
					values={{smbUrl}}
					components={{
						field: <InlineCopyableField value={smbUrl} />,
					}}
				/>
			</InstructionItem>
			<InstructionItem>
				<Trans
					t={t}
					i18nKey='files-share.instructions.ios.enter-username'
					values={{username}}
					components={{
						field: <InlineCopyableField value={username} />,
					}}
				/>
			</InstructionItem>
			<InstructionItem>
				<Trans
					t={t}
					i18nKey='files-share.instructions.ios.enter-password'
					values={{password}}
					components={{
						field: <InlineCopyableField value={password} />,
					}}
				/>
			</InstructionItem>
			<InstructionItem>{t('files-share.instructions.ios.tap-connect')}</InstructionItem>
		</InstructionContainer>
	)
}
