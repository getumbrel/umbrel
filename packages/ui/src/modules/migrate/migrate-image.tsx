import {FadeInImg} from '@/components/ui/fade-in-img'
import {trpcReact} from '@/trpc/trpc'

const FROM_RASPBERRY_PI_URL = '/figma-exports/migrate-raspberrypi-umbrel-home.png'
const FROM_UMBREL_URL = '/figma-exports/migrate-umbrel-home-umbrel-home.png'

export function MigrateImage() {
	const isMigrationFromUmbrelQ = trpcReact.migration.isMigratingFromUmbrelHome.useQuery()

	const url = isMigrationFromUmbrelQ.data ? FROM_UMBREL_URL : FROM_RASPBERRY_PI_URL

	return <FadeInImg src={url} width={111} height={104} alt='' />
}
