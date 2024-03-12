import Dockerode from 'dockerode'

const docker = new Dockerode()

const DOWNLOADING_PERCENT = 0.75
const EXTRACTING_PERCENT = 0.25

export async function pull(image: string, updateProgress: (progress: number) => void) {
	return new Promise((resolve, reject) => {
		docker.pull(image, (error: Error, stream: NodeJS.ReadableStream) => {
			if (error) return reject(error)

			const layerProgress: Record<string, number> = {}

			function progress() {
				const totalProgress = Object.values(layerProgress).reduce((total, layer) => total + layer, 0)
				return totalProgress / Object.keys(layerProgress).length
			}

			function onFinished(error: Error | null, output: any) {
				if (error) return reject(error)

				updateProgress(1)
				resolve(true)
			}

			function onProgress(event: any) {
				if (event.status === 'Pulling fs layer') {
					layerProgress[event.id] = 0
				}
				if (event.status === 'Downloading') {
					const downloadPercent = event.progressDetail.current / event.progressDetail.total
					layerProgress[event.id] = downloadPercent * DOWNLOADING_PERCENT
					updateProgress(progress())
				}
				if (event.status === 'Extracting') {
					const extractPercent = event.progressDetail.current / event.progressDetail.total
					layerProgress[event.id] = DOWNLOADING_PERCENT + extractPercent * EXTRACTING_PERCENT
					updateProgress(progress())
				}
			}

			docker.modem.followProgress(stream, onFinished, onProgress)
		})
	})
}

export async function pullAll(images: string[], updateProgress: (progress: number) => void) {
	const imageProgress: Record<string, number> = {}
	for (const image of images) {
		imageProgress[image] = 0
	}
	await Promise.all(
		images.map(async (image) =>
			pull(image, (progress) => {
				imageProgress[image] = progress
				const totalProgress = Object.values(imageProgress).reduce((total, image) => total + image, 0) / images.length
				updateProgress(totalProgress)
			}),
		),
	)

	return true
}
