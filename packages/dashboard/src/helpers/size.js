// Converts number of bytes to human readable size

export function readableSize(n) {
  if (n === 0) return "0 MB";
  if (n < 1e3) return `${Number(n.toFixed(1))} Bytes`;
  if (n >= 1e3 && n < 1e6) return `${Number((n / 1e3).toFixed(1))} KB`;
  if (n >= 1e6 && n < 1e9) return `${Number((n / 1e6).toFixed(1))} MB`;
  if (n >= 1e9 && n < 1e12) return `${Number((n / 1e9).toFixed(1))} GB`;
  if (n >= 1e12 && n < 1e15) return `${Number((n / 1e12).toFixed(1))} TB`;
  if (n >= 1e15) return `${Number(+(n / 1e15).toFixed(1))} PB`;
}