import {IOSInstructions} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/ios-instructions'
import {MacOSInstructions} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/macos-instructions'
import {WindowsInstructions} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/windows-instructions'
import {Platform} from '@/features/files/components/dialogs/share-info-dialog/platform-selector'

interface PlatformInstructionsProps {
	platform: Platform
	smbUrl: string
	username: string
	password: string
	name: string
}

export function PlatformInstructions({platform, smbUrl, username, password, name}: PlatformInstructionsProps) {
	if (platform.id === 'macos') {
		return <MacOSInstructions smbUrl={smbUrl} username={username} password={password} name={name} />
	}

	if (platform.id === 'windows') {
		return <WindowsInstructions smbUrl={smbUrl} username={username} password={password} />
	}

	if (platform.id === 'ios') {
		return <IOSInstructions smbUrl={smbUrl} username={username} password={password} />
	}

	return null
}
