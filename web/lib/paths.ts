import path from "path";

/** Repository root (contains clipper/, output/). */
export function getRepoRoot(): string {
  const fromEnv = process.env.CLIPPER_REPO_ROOT?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.resolve(process.cwd(), "..");
}

export function getOutputRoot(): string {
  const fromEnv = process.env.CLIPPER_OUTPUT?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.join(getRepoRoot(), "output");
}
