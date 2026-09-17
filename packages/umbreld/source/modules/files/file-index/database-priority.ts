// Background work yields to foreground requests. Equal priorities stay FIFO.
export const BACKGROUND_DATABASE_PRIORITY = -10
// Root scans stay ahead of enrichment, but yield to default-priority Photos
// preparation and user mutations without changing their FIFO ordering.
export const SCAN_DATABASE_PRIORITY = -5
// Entry lookups and thumbnail metadata share this priority so new thumbnail
// requests cannot repeatedly overtake an earlier Files lookup.
export const ON_DEMAND_DATABASE_PRIORITY = 20
