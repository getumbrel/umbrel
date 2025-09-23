/**
 * Checks if a given path represents a network device.
 * Valid path example: "/Network/samba.orb.local"
 * @param path The file system path to check
 * @returns boolean indicating if the path is a network device
 */
export const isDirectoryANetworkDevice = (path: string): boolean => {
	// Path must start with /Network and have exactly one more segment (the host name)
	return path.startsWith('/Network/') && path.split('/').filter(Boolean).length === 2
}

/**
 * Checks if a given path represents a network share.
 * Valid path example: "/Network/samba.orb.local/Documents"
 * @param path The file system path to check
 * @returns boolean indicating if the path is a network share
 */
export const isDirectoryANetworkShare = (path: string): boolean => {
	// Path must start with /Network and have exactly two more segments (host name + share name)
	return path.startsWith('/Network/') && path.split('/').filter(Boolean).length === 3
}
