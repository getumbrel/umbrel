import {Trans} from 'react-i18next/TransWithoutContext'

import {InlineCopyableField} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/inline-copyable-field'
import {
	InstructionContainer,
	InstructionItem,
} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/instruction'
import {t} from '@/utils/i18n'

interface IOSInstructionsProps {
	smbUrl: string
	username: string
	password: string
}

export function IOSInstructions({smbUrl, username, password}: IOSInstructionsProps) {
	return (
		<InstructionContainer>
			<InstructionItem>{t('files-share.instructions.ios.install-files')}</InstructionItem>
			<InstructionItem>{t('files-share.instructions.ios.tap-dots')}</InstructionItem>
			<InstructionItem>
				<Trans
					i18nKey='files-share.instructions.ios.enter-server'
					values={{smbUrl}}
					components={{
						field: <InlineCopyableField value={smbUrl} />,
					}}
				/>
			</InstructionItem>
			<InstructionItem>
				<Trans
					i18nKey='files-share.instructions.ios.enter-username'
					values={{username}}
					components={{
						field: <InlineCopyableField value={username} />,
					}}
				/>
			</InstructionItem>
			<InstructionItem>
				<Trans
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
