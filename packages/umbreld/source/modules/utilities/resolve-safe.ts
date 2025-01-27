import nodePath from 'node:path'
import fse from 'fs-extra'

/**
 * Resolves a target path relative to a base path, ensuring the resolved path
 * does not escape either the logical or canonical base path. If the canonical
 * base path needs to be evaluated, the base path must exist.
 */
async function resolveSafe(base: string, target = '') {
	const logicalBase = nodePath.resolve(base)
	const logicalTarget = nodePath.resolve(logicalBase, target)

	// Nothing to do when the logical target is equal to the logical base.
	if (logicalTarget === logicalBase) return logicalTarget

	// Normalize special root path before checking for sub-paths of `base`.
	const normalizeBase = (base: string) => (base.endsWith(nodePath.sep) ? base : `${base}${nodePath.sep}`)

	// Otherwise ensure that the logical target is within the logical base.
	if (!logicalTarget.startsWith(normalizeBase(logicalBase))) {
		throw new Error('Logical target must not escape logical base path')
	}

	// Walk the logical target backwards to the logical base, checking that the
	// first existing sub-path's canonical path does not escape the base's.
	let logicalCurrent = logicalTarget
	let unrecoverableError: unknown
	do {
		try {
			// Evaluating the canonical path implicitly checks if the path exists
			const canonicalCurrent = await fse.realpath(logicalCurrent)
			// Only need to evaluate canonical base when any logical current exists
			try {
				const canonicalBase = await fse.realpath(logicalBase)
				if (canonicalCurrent !== canonicalBase && !canonicalCurrent.startsWith(normalizeBase(canonicalBase))) {
					unrecoverableError = new Error('Canonical target must not escape canonical base path')
				}
			} catch (error) {
				unrecoverableError = error
			}
			break
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				unrecoverableError = error
				break
			}
			// Keep searching for the first existing sub-path
		}
		logicalCurrent = nodePath.dirname(logicalCurrent)
	} while (logicalCurrent !== logicalBase)

	// Fail when we were unable to validate the canonical base
	if (unrecoverableError) throw unrecoverableError

	return logicalTarget
}

export default resolveSafe
