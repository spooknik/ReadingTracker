export function isReaderEnabled(): boolean {
  return process.env.ENABLE_READER === "1";
}

export function isAutoRipEnabled(): boolean {
  return process.env.ENABLE_AUTO_RIP === "1";
}
