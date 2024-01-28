const FROM_RASPBERRY_PI_URL = '/figma-exports/migrate-raspberrypi-umbrel-home.png'
// const FROM_UMBREL_URL = '/figma-exports/migrate-umbrel-home-umbrel-home.png'

export function MigrateImage() {
	// TODO: call API to determine if we're migrating from Umbrel or Raspberry Pi
	const url = FROM_RASPBERRY_PI_URL

	return <img src={url} width={111} height={104} alt='' />
}
