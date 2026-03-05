/**
 * Checks if a given path represents an external drive partition.
 * Valid path example: "/External/usb1"
 * @param path The file system path to check
 * @returns boolean indicating if the path is an external drive partition
 */
export const isDirectoryAnExternalDrivePartition = (path: string): boolean => {
	// Path must start with /External and have exactly one more segment (the partition name)
	return path.startsWith('/External/') && path.split('/').filter(Boolean).length === 2
}
