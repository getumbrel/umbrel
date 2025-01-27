/** Normalizes common fs-extra errors to include the error code. */
function normalizeFsExtraError(error: unknown) {
	const message = (error as Error).message
	if (message === 'dest already exists.') {
		;(error as Error).message = `EEXIST: ${message}`
	} else if (message.startsWith('Cannot overwrite directory')) {
		;(error as Error).message = `EISDIR: ${message}`
	} else if (message.startsWith('Cannot overwrite non-directory')) {
		;(error as Error).message = `ENOTDIR: ${message}`
	} else if (message.includes('to a subdirectory of itself')) {
		;(error as Error).message = `EINVAL: ${message}`
	}
	return error
}

export default normalizeFsExtraError
