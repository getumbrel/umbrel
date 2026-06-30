// Supported rclone backends for remote mounts.
// SMB stays on kernel CIFS for now; new cloud/remotes use rclone.
export type RcloneBackend = 'webdav' | 'dropbox' | 'drive' | 'sftp'

export type RcloneRemoteConfig = {
	// Unique remote name inside a temporary rclone config file
	name: string
	type: RcloneBackend
	options: Record<string, string>
}

export type RcloneMountOptions = {
	systemMountPath: string
	userId: number
	groupId: number
	configPath: string
	cacheDirectory: string
	// writes: stream-friendly cache for uploads; good default for NAS/WebDAV
	vfsCacheMode?: 'off' | 'minimal' | 'writes' | 'full'
}
