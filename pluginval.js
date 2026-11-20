// Keep plugin paths as separate argv entries, including when they contain spaces.
export function pluginvalCommand(bin, args) {
  return process.platform === 'linux' && (process.env.CI || !process.env.DISPLAY)
    ? { cmd: 'xvfb-run', args: ['-a', bin, ...args] }
    : { cmd: bin, args };
}
