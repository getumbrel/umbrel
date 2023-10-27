import {createTRPCReact} from '@trpc/react-query'
import {inferRouterInputs, inferRouterOutputs} from '@trpc/server'

import type {AppRouter} from '../../../../packages/umbreld/source/modules/server/trpc/index'

export type {Category} from '../../../../packages/umbreld/source/modules/apps/schema'

export {categories} from '../../../../packages/umbreld/source/modules/apps/data'

export const trpcReact = createTRPCReact<AppRouter>()

// Types ----------------------------

export type RouterInput = inferRouterInputs<AppRouter>
export type RouterOutput = inferRouterOutputs<AppRouter>

export type RegistryApp = NonNullable<RouterOutput['appStore']['registry'][number]>['apps'][number]
