/**
 * Nix devshell environment variables that contaminate child processes when
 * tmux is started from inside a `nix develop` shell. These are passed via
 * tmux's global environment to every new session, which breaks `nix develop`
 * invocations inside Workshop sessions (e.g. MCP server startup).
 *
 * We clear them at session-creation time using tmux's `-e VAR=` flag, which
 * overrides the global environment for that specific session only.
 */
const NIX_DEVSHELL_VARS = [
  // nix develop / nix shell markers and build env
  'IN_NIX_SHELL',
  'CONFIG_SHELL',
  'HOST_PATH',
  'CFLAGS',
  'CPPFLAGS',
  'LDFLAGS',
  'NIX_CC',
  'NIX_BINTOOLS',
  'NIX_BUILD_CORES',
  'NIX_CFLAGS_COMPILE',
  'NIX_LDFLAGS',
  'NIX_APPLE_SDK_VERSION',
  'NIX_DONT_SET_RPATH',
  'NIX_DONT_SET_RPATH_FOR_BUILD',
  'NIX_ENFORCE_NO_NATIVE',
  'NIX_HARDENING_ENABLE',
  'NIX_IGNORE_LD_THROUGH_GCC',
  'NIX_NO_SELF_RPATH',
  // npm_config_* vars set by nix node packages — conflict with nvm in session shells
  'npm_config_prefix',
  'npm_config_global_prefix',
  'npm_config_globalconfig',
  'npm_config_local_prefix',
  'npm_config_node_gyp',
  'npm_config_noproxy',
  'npm_config_npm_version',
  'npm_config_user_agent',
  'npm_config_userconfig',
  'npm_config_cache',
  'npm_config_init_module',
  // direnv state vars — cause direnv to unload on every session start
  'DIRENV_DIR',
  'DIRENV_FILE',
  'DIRENV_DIFF',
  'DIRENV_WATCHES',
  // Workshop's own server config (set by the launchd plist) — leaked into sessions, `npm run dev` binds prod's port and DB
  'NODE_ENV',
  'PORT',
  'WORKSHOP_DB_PATH',
] as const;

/** tmux `-e VAR=` flags that clear nix devshell contamination for new sessions.
 *  Only emitted for vars that are actually present — avoids spuriously setting
 *  empty vars on machines that don't have nix/direnv, which can trigger direnv
 *  hooks and introduce shell startup latency that causes send-keys races. */
export const NIX_CLEAN_TMUX_FLAGS = NIX_DEVSHELL_VARS
  .filter((v) => v in process.env)
  .map((v) => `-e ${v}=`)
  .join(' ');

/**
 * Propagate PATH from the Workshop server process into every new tmux session.
 *
 * tmux sessions inherit their environment from the tmux *server's* global
 * environment (set when the server first started), not from the process that
 * runs `tmux new-session`. On machines without a system-level Node install
 * (e.g. WSL using nix flakes), the server-start-time PATH may not include the
 * nix store paths where `claude` lives. Explicitly passing Workshop's own PATH
 * ensures the session shell can reach whatever tools Workshop itself can reach.
 */
export const TMUX_PATH_FLAG = process.env.PATH
  ? `-e PATH=${JSON.stringify(process.env.PATH)}`
  : '';
