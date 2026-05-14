import semver from 'semver'

const WHATS_NEW_PREVIOUS_VERSION_SEMVER_CUTOFF = '1.7.0'
export const WHATS_NEW_VERSION_NAME = 'umbrelOS 1.7'

export function shouldShowWhatsNew(previousVersion?: string) {
	if (!previousVersion) return false

	const coercedPreviousVersion = semver.coerce(previousVersion)
	if (!coercedPreviousVersion) return false

	return semver.lt(coercedPreviousVersion, WHATS_NEW_PREVIOUS_VERSION_SEMVER_CUTOFF)
}
