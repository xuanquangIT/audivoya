// Type declarations for ports.mjs so strict TypeScript (playwright.config.ts, Vite configs,
// app code) can import it: `import { port } from './scripts/worktree/ports.mjs';`

export interface ResolvePortsOptions {
  /** Directory inside the checkout; defaults to `process.cwd()`. */
  cwd?: string | undefined;
  /** Environment consulted for explicit overrides; defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>> | undefined;
}

export interface ResolvedPorts {
  /** 0 = legacy defaults (main checkout, CI); N >= 1 = worktree slot. */
  slot: number;
  /** Port number per configured name, e.g. `AUDIVOYA_DEV_PORT`. */
  ports: Record<string, number>;
}

export interface WorktreeFiles {
  root: string | null;
  configPath: string | null;
  statePath: string | null;
}

/** Resolves slot and ports: explicit env var > `.worktree.json` slot formula > legacy. */
export declare function resolvePorts(
  options?: ResolvePortsOptions,
): ResolvedPorts;

/** Resolves one configured port; throws when the name is not configured. */
export declare function port(
  name: string,
  options?: ResolvePortsOptions,
): number;

/** Finds the nearest `.worktree.json` and `.agents/workspace.json`, stopping at `.git`. */
export declare function locateWorktreeFiles(cwd: string): WorktreeFiles;

/** Parses an explicit `NAME=value` port override; throws when invalid. */
export declare function parsePortOverride(name: string, raw: string): number;

/** CLI entry point; returns the exit code. */
export declare function main(argv?: string[]): number;
