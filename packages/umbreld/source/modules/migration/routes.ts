import {router, privateProcedure, publicProcedureWhenNoUserExists} from '../server/trpc/trpc.js'

import {
	findExternalUmbrelInstall,
	runPreMigrationChecks,
	migrateData,
	getMigrationStatus,
	unmountExternalDrives,
} from './migration.js'
import isUmbrelHome from '../is-umbrel-home.js'

export default router({
	isUmbrelHome: privateProcedure.query(() => isUmbrelHome()),
	// TODO: Implement
	isMigratingFromUmbrelHome: privateProcedure.query(() => false),

	canMigrate: privateProcedure.query(async ({ctx}) => {
		const currentInstall = ctx.umbreld.dataDirectory
		const externalUmbrelInstall = await findExternalUmbrelInstall()
		await runPreMigrationChecks(currentInstall, externalUmbrelInstall as string, ctx.umbreld)
		await unmountExternalDrives()

		return true
	}),

	// TODO: Refactor this into a subscription
	migrationStatus: publicProcedureWhenNoUserExists.query(() => getMigrationStatus()),

	migrate: privateProcedure.mutation(async ({ctx}) => {
		const currentInstall = ctx.umbreld.dataDirectory
		const externalUmbrelInstall = await findExternalUmbrelInstall()
		await runPreMigrationChecks(currentInstall, externalUmbrelInstall as string, ctx.umbreld)

		void migrateData(currentInstall, externalUmbrelInstall as string, ctx.umbreld)

		return true
	}),
})
