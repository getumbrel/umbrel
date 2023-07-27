import {router, privateProcedure} from '../trpc.js'

import {
	findExternalUmbrelInstall,
	runPreMigrationChecks,
	migrateData,
	getMigrationStatus,
	unmountExternalDrives,
} from '../../../modules/migration.js'
import isUmbrelHome from '../../../modules/is-umbrel-home.js'

export default router({
	isUmbrelHome: privateProcedure.query(() => isUmbrelHome()),

	canMigrate: privateProcedure.query(async ({ctx}) => {
		const currentInstall = ctx.umbreld.dataDirectory
		const externalUmbrelInstall = await findExternalUmbrelInstall()
		await runPreMigrationChecks(currentInstall, externalUmbrelInstall)
		await unmountExternalDrives()

		return true
	}),

	// TODO: Refactor this into a subscription
	migrationStatus: privateProcedure.query(() => getMigrationStatus()),

	migrate: privateProcedure.mutation(async ({ctx}) => {
		const currentInstall = ctx.umbreld.dataDirectory
		const externalUmbrelInstall = await findExternalUmbrelInstall()
		await runPreMigrationChecks(currentInstall, externalUmbrelInstall)

		void migrateData(currentInstall, externalUmbrelInstall)

		return true
	}),
})
