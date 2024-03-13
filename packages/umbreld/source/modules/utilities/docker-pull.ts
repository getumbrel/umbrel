import Dockerode from 'dockerode'

const docker = new Dockerode()

const DOWNLOADING_PERCENT = 0.75
const EXTRACTING_PERCENT = 0.25

export async function pull(
	image: string,
	updateProgress: (progress: number) => void,
	handleAlreadyDownloaded: () => void,
) {
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

				const alreadyDownloaded = Object.entries(layerProgress).length === 0
				if (alreadyDownloaded) handleAlreadyDownloaded()

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
	let lastTotalProgress = 0
	const imageProgress: Record<string, number> = {}
	const alreadyDownloadedImages: string[] = []
	for (const image of images) {
		imageProgress[image] = 0
	}
	await Promise.all(
		images.map(async (image) =>
			pull(
				image,
				(progress) => {
					if (alreadyDownloadedImages.includes(image)) return
					imageProgress[image] = progress
					const totalProgress =
						Object.values(imageProgress).reduce((total, image) => total + image, 0) /
						Object.values(imageProgress).length
					// We need this because somehow progress can occasionally go backwards
					// I'm not sure why, maybe we aren't guaranteed to get the events in the
					// correct order?
					if (totalProgress > lastTotalProgress) {
						updateProgress(totalProgress)
						lastTotalProgress = totalProgress
					}
				},
				// Already downloaded so fix progress
				() => {
					delete imageProgress[image]
					alreadyDownloadedImages.push(image)
				},
			),
		),
	)

	return true
}
