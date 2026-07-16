import {$} from 'execa'

// Resolves image references (like `repo:tag` or `repo:tag@sha256:digest`) to the
// ids of the images they currently point to in the local Docker store. Docker
// exits non zero when any reference is missing but still prints the ids it can
// resolve, so we tolerate the error and use whatever output we get. This lets
// callers safely diff before/after update states.
export async function resolveImageIds(imageReferences: string[]) {
	const references = [...new Set(imageReferences)]
	if (references.length === 0) return new Set<string>()
	const result = await $`docker image inspect --format {{.Id}} ${references}`.catch((error) => error)
	return new Set<string>((result.stdout ?? '').split('\n').filter(Boolean))
}

// Lists all local images with their id, tag count and registry digests. Images
// pulled by digest have no tags but retain a repo digest, images built locally
// have neither. We tolerate inspect errors so an image removed between the list
// and the inspect doesn't fail the entire listing.
export async function listImages() {
	const {stdout} = await $`docker image ls --all --no-trunc --quiet`
	const imageIds = [...new Set(stdout.split('\n').filter(Boolean))]
	if (imageIds.length === 0) return []
	const format = '{{.Id}}\t{{len .RepoTags}}\t{{json .RepoDigests}}'
	const inspection = await $`docker image inspect --format ${format} ${imageIds}`.catch((error) => error)
	return ((inspection.stdout ?? '') as string)
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [id, repoTags, repoDigestsJson] = line.split('\t')
			const repoDigests = (JSON.parse(repoDigestsJson) ?? []) as string[]
			return {id, repoTags: Number(repoTags), repoDigests}
		})
}

// Lists the image ids referenced by all containers in any state. Docker won't
// remove these images without force so we treat them as always in use.
export async function listContainerImageIds() {
	const {stdout: containerList} = await $`docker ps --all --quiet`
	const containerIds = containerList.split('\n').filter(Boolean)
	if (containerIds.length === 0) return new Set<string>()
	const result = await $`docker container inspect --format {{.Image}} ${containerIds}`.catch((error) => error)
	return new Set<string>((result.stdout ?? '').split('\n').filter(Boolean))
}

// Returns true if the image currently has no tags. Used as a final guard before
// removing an image by id so we never remove an image the user has tagged, or
// one that was re-tagged while we were working.
export async function imageHasNoTags(imageId: string) {
	const format = '{{len .RepoTags}}'
	const result = await $`docker image inspect --format ${format} ${imageId}`.catch((error) => error)
	return result.stdout?.trim() === '0'
}

// Extracts the repository from an image reference or repo digest, so
// `registry:5000/repo:tag@sha256:digest` becomes `registry:5000/repo`
export function imageRepository(imageReference: string) {
	const withoutDigest = imageReference.split('@')[0]
	const lastColon = withoutDigest.lastIndexOf(':')
	const lastSlash = withoutDigest.lastIndexOf('/')
	return lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest
}
