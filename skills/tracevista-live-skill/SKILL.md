---
name: tracevista-live-skill
description: Start, inspect, reuse and stop a local TraceVista live viewer for the current agent session or another selected Codex, Claude Code or DeepSeek Harness native JSONL session. Use when asked to watch an agent as it works or monitor an ongoing local session.
---

# TraceVista Live

Follow one local session while the agent continues working. The background service
reads appended records; the agent does not need to poll or repeatedly invoke this skill.
Use `tracevista-skill` instead for a fully authored retrospective trajectory.

## Prepare

The helper requires Python 3.10+ on macOS/Linux and a TraceVista checkout with
`integrations/live-session/serve_live.py` and a built `dist/index.html`.
Use the existing checkout when available. If this skill was installed separately,
pass `--repo /absolute/path/TraceVista` to `start`. Do not assume the skill directory
contains the viewer. If missing, clone https://github.com/Superone77/TraceVista into
an appropriate local directory, then run `pnpm install --frozen-lockfile` and
`pnpm build` there (Node >=24, pnpm >=11). If the checkout lacks live support,
report that instead of substituting a static viewer.

Resolve `scripts/live.py` relative to this skill. Commands below use `$LIVE` for its
absolute path; `$REPO` is the selected TraceVista checkout. Output is JSON.

## Select the exact session

- **Monitor yourself:** use a current-session ID provided by the host. For Codex,
  `start --self` uses `CODEX_THREAD_ID`. Other hosts should pass their known ID with
  `--self --session-id ID`, or their native log with `--source PATH`.
- **Monitor another agent:** use the user's explicit log path or session ID. This
  works even when the monitoring agent and target agent are different products.
- **Find candidates:** `python3 "$LIVE" list` searches Codex's local `sessions`
  and Claude Code's `projects` directories. It prints paths, IDs, formats and
  modification times, never message contents. Use `--root DIRECTORY` (repeatable)
  for custom locations or Harness sessions; `--agent` and `--session-id` filter.
- Do not treat the most recently modified file as the current session. If no
  trusted current ID/path is available, list candidates and ask which to follow.
  More than one exact ID match also needs an explicit path.

## Start and open

```sh
# Current Codex session (requires CODEX_THREAD_ID)
python3 "$LIVE" start --self --repo "$REPO"

# Any explicitly selected local session; format is detected from metadata
python3 "$LIVE" start --source /absolute/path/session.jsonl --repo "$REPO"

# Current session identified by its host, including non-default storage
python3 "$LIVE" start --self --session-id SESSION_ID --root /session/directory --repo "$REPO"
```

`start` chooses a free loopback port and reuses a healthy service for the same
source. It returns `id`, `url`, `running` and `reused`. Open the **complete returned
URL** in the user's browser using available browser tools; its fragment carries
local access authorization. Do not drop the fragment or use the hosted website:
this live viewer connects to the local service. Report the link and keep the tab
open. Check that records appear before calling it connected.

The service is detached, so you can continue your original task while it watches
your own log. Do not wait in a monitoring loop. Monitoring another agent does not
launch or send instructions to that agent. If requested to start an agent as well,
use that host's normal launch flow and connect its resulting native session log.

## Local Claude Code / Codex connection

The live plugin bundle contains the built viewer and local bridge. Its root can
be passed as `--repo`; no extra viewer checkout is needed. From source, build and
package with `pnpm build` then `pnpm package:live-plugin --out NEW_DIRECTORY`.
Claude Code and Codex discover this skill through the plugin's `skills/` directory.

In Summary settings, choose **Claude Code**, **Codex** or **Custom API**, then choose
a model. The same local selection powers Chat. No API key needs to be entered for
local CLI connections: install and log in with the corresponding CLI beforehand.
Codex models come from its app-server catalog; Claude choices are CLI aliases,
not a guarantee of account entitlement. Full model IDs can also be entered.
Usage follows the CLI's configured account. Starting a viewer does not enable
automatic summaries. A live connection is local, not offline model inference.

Analysis runs in separate temporary sessions, never resumes the watched session,
and does not persist new trajectory logs. Claude tools/customizations are disabled.
Codex uses a read-only sandbox with shell, browser, apps and multi-agent features
disabled and user config ignored; it reuses authentication, but custom provider
configuration may require Custom API. Do not describe this as bypassing CLI login,
quota or permission policies.

## Summaries and controls

Raw records need no model or API key. The user can enable **Automatic summaries**
in **Summary settings**. Existing Chat settings may be reused; never invent a key,
copy credentials between providers, or enable paid analysis merely to start watching.
Text goes to the selected model; images are excluded. Summaries run in bounded
batches, newest first. The first semantic graph appears without waiting for all
history. Earlier history fills in afterwards; new activity takes priority.
Nodes remain in chronological order, with stable IDs and evidence links.
Runtime metadata stays in raw evidence and is not shown as an invented action.
Story starts closed in live mode. Now centers the newest node at the selected level; Pause freezes
reading and cancels summary work; Resume continues. The page's Stop live stops that
viewer's updates, not the background service or the monitored agent.

Avoid refreshing a configured page: newly entered keys remain in memory. Enable
automatic summaries in only one tab for a session to avoid duplicate model requests.

## Status and stop

```sh
python3 "$LIVE" status
python3 "$LIVE" stop --id SERVICE_ID
```

`stop` authenticates to the managed TraceVista service. It does not signal the
monitored agent or kill an arbitrary saved PID. Captured journals remain available;
starting the same unchanged source resumes them. A rewritten log requires a fresh
journal (use a new `--state-dir`), not silent deletion of existing evidence.

State defaults to `~/.cache/tracevista-live` with private permissions. For a scoped
workspace or tests, pass the same `--state-dir /private/local/directory` to all
commands. State includes private source paths, local access tokens and captured
logs: do not commit or publish it. The service binds only to loopback. SSH and
public livestream links are outside this skill's current scope.
