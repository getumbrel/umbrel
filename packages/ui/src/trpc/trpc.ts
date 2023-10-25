import {createTRPCReact} from '@trpc/react-query'

import type {AppRouter} from '../../../../packages/umbreld/source/modules/server/trpc/index'

/** IMPORTANT: only for `/app` routes */
export const trpcReact = createTRPCReact<AppRouter>()
