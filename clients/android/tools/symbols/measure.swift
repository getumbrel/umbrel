import AppKit
// Renders an SF Symbol at 600 pt on a 960 px canvas, for measure_pieces.py.
// usage: swift measure.swift <symbol name> <out.png>
let name = CommandLine.arguments[1], out = CommandLine.arguments[2]
let side: CGFloat = 960
let config = NSImage.SymbolConfiguration(pointSize: 600, weight: .regular)
let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)!.withSymbolConfiguration(config)!
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(side), pixelsHigh: Int(side), bitsPerSample: 8,
	samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: side, height: side)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let s = image.size
image.draw(in: NSRect(x: (side - s.width) / 2, y: (side - s.height) / 2, width: s.width, height: s.height))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print(s)
