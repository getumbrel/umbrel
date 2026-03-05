import {createContext} from 'react'

import type {ConfirmationContextType} from '@/providers/confirmation/types'

// Create the context with a default value
export const ConfirmationContext = createContext<ConfirmationContextType | undefined>(undefined)
