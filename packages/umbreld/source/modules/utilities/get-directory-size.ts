import {$} from 'execa'

// Get a directory size in bytes
async function getDirectorySize(directoryPath: string) {
	const du = await $`du --summarize --bytes ${directoryPath}`
	const totalSize = parseInt(du.stdout.split('\t')[0], 10)

	return totalSize
}

export default getDirectorySize
