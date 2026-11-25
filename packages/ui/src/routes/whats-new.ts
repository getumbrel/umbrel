import semver from 'semver'

// Anyone updating from a version before this one sees What's New. A pre-release counts as earlier
// than its release, so beta testers coming from 2.1 Beta 1 see it too, and no one sees it twice.
const WHATS_NEW_PREVIOUS_VERSION_SEMVER_CUTOFF = '2.1.0-beta.2'
export const WHATS_NEW_VERSION_NAME = 'umbrelOS 2.1'

export function shouldShowWhatsNew(previousVersion?: string) {
	if (!previousVersion) return false

	const coercedPreviousVersion = semver.coerce(previousVersion, {includePrerelease: true})
	if (!coercedPreviousVersion) return false

	return semver.lt(coercedPreviousVersion, WHATS_NEW_PREVIOUS_VERSION_SEMVER_CUTOFF)
}
