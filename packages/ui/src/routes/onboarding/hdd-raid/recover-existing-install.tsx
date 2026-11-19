import {RecoverExistingInstall} from '../raid/recover-existing-install'
import {StorageDevice} from '../raid/use-raid-setup'

// The same restore screen and flow as Umbrel Pro's, shown without its picture
export function HddRecoverExistingInstall({
	devices,
	onSetUpAsNew,
}: {
	devices: StorageDevice[]
	onSetUpAsNew: () => void
}) {
	return <RecoverExistingInstall devices={devices} variant='generic' onSetUpAsNew={onSetUpAsNew} />
}
