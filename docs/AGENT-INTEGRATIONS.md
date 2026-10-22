# Use TraceVista in your agent

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
| MiniMax Code | MiniApp with the bundled viewer, skill and host Agent Chat | Open **TraceVista** in MiniApps |

These entries describe where the **conversion skill can run**. They do not imply
that every agent's private session format has a parser. The extractor supports
Claude Code, Codex, Pi, DeepSeek Harness, MiniMax Code JSONL snapshots, InferenceBench and SWE-rebench formats;
Cursor, Gemini CLI and OpenCode can convert those inputs too. For another input,
inspect its format and add an adapter before claiming a complete conversion.

The files in this branch support local installation. The GitHub installation
commands below apply after these files reach the requested remote ref.
TraceVista is not listed in the agents' official marketplaces.

### MiniMax Code MiniApp

Build the self-contained MiniApp with `pnpm build:minimax-miniapp`, then install
the generated `integrations/minimax-miniapp/.build/tracevista` directory into
MiniMax's plugins directory. Requires MiniMax Code 3.1.2 or later.
The conversion skill is included; Chat defaults to the MiniMax Agent with host
credentials. You can still choose your own API. Select a source log explicitly:
MiniMax's public API does not expose the parent conversation history, and a
`messages.jsonl` file may contain only the active generation after compaction.

See [installation, use and validation status](../integrations/minimax-miniapp/README.md).
This package includes the viewer; the small skill-only package below does not.

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
