import {IOSInstructions} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/ios-instructions'
import {MacOSInstructions} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/macos-instructions'
import {UmbrelOSInstructions} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/umbrelos-instructions'
import {WindowsInstructions} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/windows-instructions'
import {Platform} from '@/features/files/components/dialogs/share-info-dialog/platform-selector'

interface PlatformInstructionsProps {
	platform: Platform
	smbUrl: string
	username: string
	password: string
	name: string
	sharename?: string
}

export function PlatformInstructions({
	platform,
	smbUrl,
	username,
	password,
	name,
	sharename,
}: PlatformInstructionsProps) {
	if (platform.id === 'macos') {
		return <MacOSInstructions smbUrl={smbUrl} username={username} password={password} name={name} />
	}

	if (platform.id === 'windows') {
		return <WindowsInstructions smbUrl={smbUrl} username={username} password={password} />
	}

	if (platform.id === 'ios') {
		return <IOSInstructions smbUrl={smbUrl} username={username} password={password} />
	}

	if (platform.id === 'umbrelos') {
		return <UmbrelOSInstructions username={username} password={password} sharename={sharename} />
	}

	return null
}
