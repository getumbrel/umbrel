import {router, publicProcedureWhenNoUserExists} from '../server/trpc/trpc.js'

const internalStorage = router({
	// Get internal storage devices (NVMe, HDD, eMMC, etc.)
	getDevices: publicProcedureWhenNoUserExists.query(async ({ctx}) => ctx.umbreld.hardware.internalStorage.getDevices()),
})

export default router({
	internalStorage,
})
