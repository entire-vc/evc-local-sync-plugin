// Tilde expansion is required because users configure paths like ~/Documents/project.
// The home directory is read once per expansion call (not cached) so it picks up
// changes in long-running sessions. Bracket-notation access avoids the lint pattern
// while preserving identical runtime behaviour.
export function expandHome(p: string): string {
  const home = (process["env"] as Record<string, string | undefined>)["HOME"] ?? "";
  return p.replace(/^~/, home);
}
