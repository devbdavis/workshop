import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/** One Gitea/Forgejo login as configured for the `tea` CLI. */
export interface GiteaLogin {
  /** Hostname only, e.g. `git.example.com` — used to match PR URLs. */
  host: string;
  /** Origin, e.g. `https://git.example.com`. */
  url: string;
  token: string;
}

function configPath(): string {
  return process.env.TEA_CONFIG ?? join(homedir(), '.config', 'tea', 'config.yml');
}

/**
 * `tea`'s config is a top-level `logins:` list of `name`/`url`/`token` scalars,
 * followed by other top-level sections (`preferences:`) that reuse key names.
 * A line-scanner beats pulling in a YAML dependency for three fields, provided
 * it only reads keys inside the `logins:` block.
 * ponytail: line-scan, swap for a YAML parser if tea's login schema ever nests.
 */
function parseTeaConfig(yaml: string): GiteaLogin[] {
  const logins: GiteaLogin[] = [];
  let inLogins = false;
  let url: string | undefined;
  let token: string | undefined;

  const flush = () => {
    if (url && token) {
      try {
        logins.push({ host: new URL(url).hostname, url: new URL(url).origin, token });
      } catch {
        /* malformed url — skip this login */
      }
    }
    url = undefined;
    token = undefined;
  };

  for (const line of yaml.split('\n')) {
    // Any unindented key ends the `logins:` block and starts another section.
    if (/^\S/.test(line)) {
      if (inLogins) flush();
      inLogins = /^logins:\s*$/.test(line);
      continue;
    }
    if (!inLogins) continue;
    // A new list item (`    - name: foo`) closes the previous login.
    if (/^\s*-\s/.test(line)) flush();
    const value = (key: string) => line.match(new RegExp(`^\\s*(?:-\\s+)?${key}:\\s*(\\S+)\\s*$`))?.[1];
    url = value('url') ?? url;
    token = value('token') ?? token;
  }
  if (inLogins) flush();
  return logins;
}

let cached: GiteaLogin[] | null = null;

/** Logins from `~/.config/tea/config.yml`; empty when tea isn't configured. */
export function loadGiteaLogins(): GiteaLogin[] {
  if (cached) return cached;
  try {
    cached = parseTeaConfig(readFileSync(configPath(), 'utf8'));
  } catch {
    cached = [];
  }
  return cached;
}

export function findGiteaLogin(host: string): GiteaLogin | undefined {
  return loadGiteaLogins().find((l) => l.host === host);
}

/** Test seam — drops the memoised config. */
export function resetGiteaLoginCache(): void {
  cached = null;
}

export { parseTeaConfig };
