import {router, privateProcedure} from '../trpc.js'

import {
	findExternalUmbrelInstall,
	runPreMigrationChecks,
	migrateData,
	getMigrationStatus,
	unmountExternalDrives,
} from '../../../migration.js'
import isUmbrelHome from '../../../is-umbrel-home.js'

export default router({
	isUmbrelHome: privateProcedure.query(() => isUmbrelHome()),

	canMigrate: privateProcedure.query(async ({ctx}) => {
		const currentInstall = ctx.umbreld.dataDirectory
		const externalUmbrelInstall = await findExternalUmbrelInstall()
		await runPreMigrationChecks(currentInstall, externalUmbrelInstall as string)
		await unmountExternalDrives()

		return true
	}),

	// TODO: Refactor this into a subscription
	migrationStatus: privateProcedure.query(() => getMigrationStatus()),

	migrate: privateProcedure.mutation(async ({ctx}) => {
		const currentInstall = ctx.umbreld.dataDirectory
		const externalUmbrelInstall = await findExternalUmbrelInstall()
		await runPreMigrationChecks(currentInstall, externalUmbrelInstall as string)

		void migrateData(currentInstall, externalUmbrelInstall as string)

		return true
	}),
})
