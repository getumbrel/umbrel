import {RouterOutput} from '@/trpc/trpc'

export type Machine = RouterOutput['machines']['list'][number]
export type MachineState = Machine['state']
export type OsImage = RouterOutput['machines']['osImages'][number]
export type MachineAgentControl = RouterOutput['machines']['agentControls'][string]
