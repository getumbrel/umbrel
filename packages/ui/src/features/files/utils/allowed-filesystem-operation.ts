// TODO: This is a temporary hack until we have fixed ops in umbreld
import {isDirectoryAnExternalDrivePartition} from '@/features/files/utils/is-directory-an-external-drive-partition'

type Operation =
	| 'copy'
	| 'paste'
	| 'move'
	| 'rename'
	| 'download'
	| 'trash'
	| 'archive'
	| 'extract'
	| 'share'
	| 'favorite'

export function isOperationAllowed(path: string, operation: Operation): boolean {
	// Disable move, rename, and trash operations on the Home directory
	if (path === '/Home' && (operation === 'move' || operation === 'rename' || operation === 'trash')) {
		return false
	}

	// Disable move, rename, trash, and paste operations on the /Apps directory
	if (
		path === '/Apps' &&
		(operation === 'move' || operation === 'rename' || operation === 'paste' || operation === 'trash')
	) {
		return false
	}

	// Disable move, rename, and trash operations on the /Downloads directory
	if (path === '/Home/Downloads' && (operation === 'move' || operation === 'rename' || operation === 'trash')) {
		return false
	}

	// Disable move, rename, archive and trash operations on the /App/app-id but allow for /App/app-id/* directory
	if (
		path.startsWith('/Apps/') &&
		path.split('/').length === 3 &&
		(operation === 'move' || operation === 'rename' || operation === 'archive' || operation === 'trash')
	) {
		return false
	}

	// Disable share and favorite operations for external storage devices
	if (path.startsWith('/External/') && (operation === 'share' || operation === 'favorite')) {
		return false
	}

	// Disable all operations for external drive partitions (eg. if the user directly navigates to umbrel.local/files/External)
	if (
		isDirectoryAnExternalDrivePartition(path) &&
		(operation === 'copy' ||
			operation === 'move' ||
			operation === 'rename' ||
			operation === 'trash' ||
			operation === 'archive' ||
			operation === 'extract')
	) {
		return false
	}

	return true
}
