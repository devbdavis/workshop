---
name: dev-server
description: "Start, list, or stop a long-running dev server the user can open in their browser. Use when the user asks to spawn, start, run, or serve the app 'so I can play with it', asks for a preview URL, or asks which dev servers are running or to stop one. Tagged: workshop."
---

# Dev Server

Workshop often runs in Docker, where only a published port range reaches the user's browser. Follow this exactly so the URL you report actually works.

## Start

1. Pick a port. If `$WORKSHOP_DEV_PORTS` is set (e.g. `4100-4119`), use the first port in that range with nothing listening — `(exec 3<>/dev/tcp/127.0.0.1/<port>) 2>/dev/null` succeeds when the port is taken. If unset, any free port works.
2. Choose a name: `dev-<repo>` (append the branch if several of the same repo run). Letters, digits and `-` only. Kill an existing session of that exact name first: `tmux kill-session -t =dev-<name> 2>/dev/null`.
3. Start it detached so it survives this agent session, bound to all interfaces, logging to a file:

   ```bash
   tmux new-session -d -s dev-<name> -c <repo-dir> \
     "${WORKSHOP_DEV_HOST:+__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=$WORKSHOP_DEV_HOST }<command> 2>&1 | tee /tmp/dev-<name>.log"
   ```

   Use the project's own dev script and pass port and host its way, e.g. `npm run dev -- --host 0.0.0.0 --port <port>` (Vite), `next dev -H 0.0.0.0 -p <port>`, `python -m http.server <port> --bind 0.0.0.0`. A `localhost`/`127.0.0.1` bind is unreachable from outside the container. A second backend port also comes from the range.
4. Wait until it answers (`curl -s -o /dev/null http://127.0.0.1:<port>` in a retry loop, ~30s max; if the port is taken by another start, use the next one). On failure, read `tail -50 /tmp/dev-<name>.log` and fix the cause.
5. Report `http://<host>:<port>` and the session name, where `<host>` is `$WORKSHOP_DEV_HOST`. If that is unset but `$WORKSHOP_DEV_PORTS` is set, use "the Workshop host's name or IP" and tell the user to set `DEV_HOST` so future URLs are exact. Native install (neither set): `localhost`.

## List

`tmux list-panes -a -F '#{session_name}  #{pane_start_command}' | grep '^dev-'` — the start command shows the port.

## Stop

`tmux kill-session -t =dev-<name>`. Stop only the servers the user names; "stop all" means every `dev-*` session.
