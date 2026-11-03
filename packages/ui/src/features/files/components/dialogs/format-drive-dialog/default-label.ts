// umbreld accepts volume labels of 1 to 11 letters, digits, spaces, dashes and underscores
export const MAX_LABEL_LENGTH = 11

// The drive's model name as a volume label, whole words only: "Generic Flash Disk" becomes
// "Generic", not "Generic Fla". Words with characters a label can't hold ("3.0") are left out.
export function defaultVolumeLabel(driveName: string): string {
	const words = driveName.split(/\s+/).filter((word) => /^[A-Za-z0-9_-]+$/.test(word))
	let label = ''
	for (const word of words) {
		const next = label ? `${label} ${word}` : word
		if (next.length > MAX_LABEL_LENGTH) break
		label = next
	}
	// A first word that's too long on its own can only be cut
	return label || words[0]?.slice(0, MAX_LABEL_LENGTH) || 'Untitled'
}
