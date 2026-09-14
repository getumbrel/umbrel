declare module '@novnc/novnc' {
	export {default} from '@novnc/novnc/lib/rfb'
}

// Private module the console-agent-ownership test pins against; shape is
// deliberately opaque so the test proves it at runtime rather than by type
declare module '@novnc/novnc/lib/util/cursor.js' {
	export default class Cursor {}
}
