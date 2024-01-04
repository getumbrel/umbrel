import {createContext} from 'react'

type Variant = 'with-backdrop-blur' | 'default'
export const BackdropBlurVariantContext = createContext<Variant>('with-backdrop-blur')
