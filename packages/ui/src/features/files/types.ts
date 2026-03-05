import type {RouterOutput} from '@/trpc/trpc'

// ---------------------------- umbreld (server) Types ----------------------------

// ensure that the types are the same for files.list and files.recents
export type UmbreldFileSystemItem = RouterOutput['files']['list']['files'][number]

export type Favorite = RouterOutput['files']['favorites'][number]

export type Share = RouterOutput['files']['shares'][number]

export type ExternalStorageDevice = RouterOutput['files']['externalDevices'][number]

export type ViewPreferences = RouterOutput['files']['viewPreferences']

// ---------------------------- Client Types ----------------------------

export interface FileSystemItem extends UmbreldFileSystemItem {
	isUploading?: boolean // true if the item is currently being uploaded
	progress?: number // upload progress in percentage 0-100
	speed?: number // upload speed in bytes per second
	tempId?: string // we don't use path since an item with the same name can be uploaded to the same path
}

export interface UploadStats {
	totalProgress: number // 0-100
	totalSpeed: number // bytes per second
	totalUploaded: number // bytes
	totalSize: number // bytes
	eta: string // formatted string like "5s", "2m", "1hr 30m"
}

export type PolymorphicPropsWithoutRef<T extends React.ElementType, P> = P &
	Omit<React.ComponentPropsWithoutRef<T>, keyof P | 'as' | 'className'> & {
		as?: T
		className?: string
	}

export type PolymorphicRef<C extends React.ElementType> = React.ComponentPropsWithRef<C>['ref']

export type PolymorphicPropsWithRef<T extends React.ElementType, P> = PolymorphicPropsWithoutRef<T, P> & {
	ref?: PolymorphicRef<T>
}
