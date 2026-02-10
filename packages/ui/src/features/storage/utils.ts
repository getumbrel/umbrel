import prettyBytes from 'pretty-bytes'

// Format bytes without space, rounding to integer only for 3+ digit values (>=100) to avoid overflow
// e.g., "4.5TB", "45.2GB", "256GB" - only 256.1GB gets rounded because 256 >= 100
export const formatStorageSize = (bytes: number) => {
	// First format with 1 decimal to determine the numeric value
	const formatted = prettyBytes(bytes, {maximumFractionDigits: 1})
	const numericValue = parseFloat(formatted)

	// If 3+ digits (>=100), round to integer to keep string short
	const fractionDigits = numericValue >= 100 ? 0 : 1

	return prettyBytes(bytes, {maximumFractionDigits: fractionDigits}).replace(' ', '')
}
