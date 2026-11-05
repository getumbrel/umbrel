import {privateProcedure, router} from '../server/trpc/trpc.ts'

export default router({
	getCertificateStatus: privateProcedure.query(async ({ctx}) => ctx.umbreld.lanIngress.getCertificateStatus()),
	resetCa: privateProcedure.mutation(async ({ctx}) => ctx.umbreld.lanIngress.resetCa()),
})
