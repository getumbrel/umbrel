// The server accepts a positive epoch millisecond time up to the end of year
// 9999. Browsers report "now" when they don't know a file's time, and anything
// outside that range is omitted so the upload itself still goes through.
const MAX_LAST_MODIFIED = 253_402_300_799_999

export function uploadLastModified(file: File) {
	const {lastModified} = file
	return Number.isSafeInteger(lastModified) && lastModified > 0 && lastModified <= MAX_LAST_MODIFIED
		? lastModified
		: undefined
}
