// Tilde expansion is required because users configure paths like ~/Documents/project.
// process.env.HOME is read once per expansion call, not cached, so it picks up
// changes in long-running sessions. The scanner flags this as "system identity read"
// but the read is structural to path resolution and cannot be replaced.
export function expandHome(p: string): string {
  return p.replace(/^~/, process.env.HOME ?? "");
}
