import {z} from 'zod'

export const CaddySettingsSchema = z.object({
	enabled: z.boolean().optional().default(false),
	domain: z.string().optional().default('umbrel.local'),
	httpPort: z.number().int().optional().default(80),
	httpsPort: z.number().int().optional().default(443),
	certificatePath: z.string().optional(),
	privateKeyPath: z.string().optional(),
	forceHttps: z.boolean().optional().default(true),
})

export type CaddySettings = z.infer<typeof CaddySettingsSchema>
