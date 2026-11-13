# Use TraceVista in your agent

To continuously capture an explicitly selected local Codex, Claude Code, or
DeepSeek Harness session, see [local session tracking](../integrations/live-session/README.md).
This provides resumable capture, a local live Map/Story viewer, and optional
batched model summaries. Further integrations are tracked in [Q4 Roadmap #33](https://github.com/Superone77/TraceVista/issues/33).

Install the same `tracevista-skill` in your coding agent, then ask it to turn a
session log into an interactive trajectory. All integrations use
[`skills/tracevista-skill`](../skills/tracevista-skill/SKILL.md) as their source.

```text
Use tracevista-skill to convert [trajectory file or folder] into a complete
.agent-state.json, then open https://tracevista.pages.dev/ in my browser and import it.
```

The conversion scripts need Python 3.10+. The invoking agent reads the evidence
and writes the interpretation; the scripts compile and validate it. If the agent
cannot control your browser, open the website and choose **Import Trajectory**.

## Choose an installation

| Agent | Distribution | How to invoke |
|---|---|---|
| Claude Code | Plugin and repository marketplace | `/tracevista:tracevista-skill` |
| Codex | Plugin and local/repository marketplace; standalone skill also supported | Ask for `tracevista-skill` |
| Cursor | Local plugin containing the shared skill | `/tracevista-skill` |
| Gemini CLI | Extension containing the shared skill | Ask for `tracevista-skill` |
| OpenCode | Native skill | Ask for `tracevista-skill` |
| Pi | Pi package containing the shared skill | `/skill:tracevista-skill` |
| DeepSeek Harness | Session analysis plugin with an embedded viewer | `/tracevista` or the session's TraceVista tab |

These entries describe where the **conversion skill can run**. They do not imply
that every agent's private session format has a parser. The extractor supports
Claude Code, Codex, Pi, DeepSeek Harness, InferenceBench and SWE-rebench formats;
Cursor, Gemini CLI and OpenCode can convert those inputs too. For another input,
inspect its format and add an adapter before claiming a complete conversion.

The files in this branch support local installation. The GitHub installation
commands below apply after these files reach the requested remote ref.
TraceVista is not listed in the agents' official marketplaces.

### Prepare a small local package

From a checkout containing these integration files, use Node.js to create the
package (`pnpm install` is not needed):

```sh
node scripts/package-agent-plugin.mjs --out "$HOME/.local/share/tracevista-agent-plugin"
```

This creates a new directory with the skill, platform manifests and license.
It excludes the viewer, example datasets, Git history and Node dependencies.
Choose a fresh destination when updating. The command does not install anything
into an agent or replace an existing directory.

The examples below use that package path. The full checkout also works with
Claude Code, Codex and Gemini CLI.

### Claude Code

Try the plugin for one session:

```sh
claude --plugin-dir "$HOME/.local/share/tracevista-agent-plugin"
```

Or install from this repository's own marketplace:

```text
/plugin marketplace add Superone77/TraceVista
/plugin install tracevista@tracevista-plugins
```

For a branch that has not reached `main`, add the local checkout instead:
`/plugin marketplace add /absolute/path/to/TraceVista`.
Start a new session and invoke `/tracevista:tracevista-skill`.

### Codex

Register the prepared package as a local marketplace:

```sh
codex plugin marketplace add "$HOME/.local/share/tracevista-agent-plugin"
codex plugin add tracevista@tracevista-plugins
```

Alternatively, after registering the marketplace, open the app's **Plugins**
view, choose **TraceVista**, and install it. Start a new chat after installation.
On CLI versions with `/plugins`, choose TraceVista there.
The included `.agents/plugins/marketplace.json` points to the package root.

For installations that use standalone skills, follow
[the Codex skill instructions](../.codex/INSTALL.md).

### Cursor

Copy the prepared package into Cursor's local plugin directory:

```sh
mkdir -p "$HOME/.cursor/plugins/local"
test ! -e "$HOME/.cursor/plugins/local/tracevista" &&
  cp -R "$HOME/.local/share/tracevista-agent-plugin" "$HOME/.cursor/plugins/local/tracevista"
```

Run **Developer: Reload Window**, then find TraceVista under **Customize**.
Use a copy: Cursor skips local plugin symlinks that point outside its local plugin
directory. Team settings must allow local plugin imports.

### Gemini CLI

Install the prepared package:

```sh
gemini extensions install "$HOME/.local/share/tracevista-agent-plugin"
```

Or install a remote ref once it contains the extension:

```sh
gemini extensions install https://github.com/Superone77/TraceVista --ref main
```

Restart Gemini CLI. For development, `gemini extensions link /absolute/path/to/TraceVista`
loads the checkout directly. The extension discovers the shared `skills/` directory.

### OpenCode

Install the native skill with [these instructions](../.opencode/INSTALL.md).
OpenCode already has a skill loader, so this integration needs no JavaScript
plugin or session bootstrap hook.

### Pi

Try the small package for one run:

```sh
pi -e "$HOME/.local/share/tracevista-agent-plugin"
```

Or retain it in Pi settings:

```sh
pi install "$HOME/.local/share/tracevista-agent-plugin"
```

Pi loads a local package in place; keep that directory after installation.
The generated `package.json` declares only the shared skill under `pi.skills`.

## Validate a package

```sh
node scripts/test-agent-plugins.mjs
claude plugin validate --strict /absolute/path/to/tracevista-agent-plugin/.claude-plugin/plugin.json
claude plugin validate --strict /absolute/path/to/tracevista-agent-plugin/.claude-plugin/marketplace.json
```

The repository checks validate package contents, manifest paths, shared skill
bytes and existing-directory protection. They do not run paid model calls.
After installing in a host, verify that `tracevista-skill` appears and convert a
known input. Installing a plugin and parsing that host's own log are separate checks.

## Design and official references

The packaging follows [Superpowers' shared-skill approach](https://github.com/obra/superpowers):
one skill source, small manifests for each host. Installation adds no automatic
session capture, model calls, startup hooks or API-key configuration.

- [Claude plugin manifests](https://code.claude.com/docs/en/plugins-reference) and [repository marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Codex plugin packaging and local marketplaces](https://developers.openai.com/plugins/build/plugins)
- [Cursor local plugins](https://cursor.com/docs/plugins) and [manifest fields](https://cursor.com/docs/reference/plugins)
- [Gemini extension reference](https://geminicli.com/docs/extensions/reference/)
- [OpenCode native skills](https://opencode.ai/docs/skills/)
- [Pi packages](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)


## Live plugin with local Claude Code / Codex models

Build a self-contained plugin (conversion skill, live skill, viewer and Python bridge):

```sh
pnpm build
pnpm package:live-plugin --out /absolute/path/to/new-tracevista-live-plugin
```

Load it in Claude Code with `claude --plugin-dir /absolute/path/to/new-tracevista-live-plugin`
and invoke `/tracevista:tracevista-live-skill`. For Codex:

```sh
codex plugin marketplace add /absolute/path/to/new-tracevista-live-plugin
codex plugin add tracevista@tracevista-plugins
```

In a new session, ask: “Use tracevista-live-skill to watch this session”, or specify
another agent's native session JSONL. The plugin starts a local background viewer;
installation itself does not launch services or modify model credentials.

In **Summary settings**, choose **Claude Code** or **Codex** and a model. Both
summaries and Chat use the selected local CLI's existing authentication. **Custom
API** remains available. Automatic summaries stay opt-in. Claude model choices
are CLI aliases, while Codex choices come from app-server `model/list`; a full
model ID can also be entered. An installed CLI does not guarantee login or access
to every model. Usage counts against the configured account.

Requests run in temporary, independent sessions; neither CLI resumes the watched
session. Claude uses `--tools ""`, safe mode and no session persistence. Codex uses
an ephemeral, read-only execution with shell, apps, browser and multi-agent
features disabled. Codex user configuration is ignored to avoid loading custom
executors; authentication is retained, but custom providers may need Custom API.
No login tokens are read by TraceVista or returned to the browser. Pause/Stop and
connection changes cancel analysis processes; requests also have a 180-second
server deadline. Responses currently appear when the CLI completes, not token by token.

The small `package:agent-plugin` includes both skills but still needs an external
built checkout for live viewing; `package:live-plugin` includes that runtime.

Interface references: [Claude CLI](https://code.claude.com/docs/en/cli-reference),
[Codex app-server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).
