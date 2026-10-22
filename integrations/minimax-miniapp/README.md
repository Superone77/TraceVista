# TraceVista for MiniMax Code

Understand your agent's work inside MiniMax Code: follow its decision map, read
Story, unfold the original evidence, play the trajectory, and ask questions with
the host's configured model. The viewer and conversion skill ship together.

## Install

Requires **MiniMax Code 3.1.2 or later** (`agentAccess` / Agent API). Python 3.10+
is needed by the conversion skill; viewing an existing `.agent-state.json` does
not need Python.

From the TraceVista source checkout:

```sh
pnpm install
pnpm build:minimax-miniapp
```

The installable plugin is `integrations/minimax-miniapp/.build/tracevista`.
Copy that **entire directory**, including `.minimax-plugin`, to
`<MiniMax data directory>/plugins/tracevista` (default `~/.minimax/plugins/tracevista`).
On macOS, for a first installation:

```sh
mkdir -p "$HOME/.minimax/plugins"
test ! -e "$HOME/.minimax/plugins/tracevista" &&
  cp -R integrations/minimax-miniapp/.build/tracevista "$HOME/.minimax/plugins/tracevista"
```

For an update, close TraceVista in MiniMax and replace only that plugin directory
with the new package. Keep MiniMax's separate plugin data directory.
Reload MiniMax Code, enable the plugin if prompted, then open **TraceVista** from
its MiniApps list. MiniMax's GitHub plugin import currently does not install
MiniApp packages; use the directory installation above.

## Use

1. If you already have a `.agent-state.json`, choose **Import Trajectory**.
2. Otherwise, enter the path of a MiniMax `messages.jsonl` file and click
   **Add conversion prompt to MiniMax**. MiniMax confirms insertion into your
   unsent draft. Review the prompt and press **Send**. The bundled
   `tracevista-skill` extracts, interprets, compiles and validates the trajectory.
3. Import the generated `.agent-state.json` into the MiniApp. Map, Story,
   original records, citations, images and Play use the same viewer as TraceVista.
4. Open **Chat**. **MiniMax Agent** is selected by default and uses the host model;
   no additional API key is needed. **Use my own API** remains available.

A selected `messages.jsonl` is an **active-generation snapshot**. Earlier records
may have been compacted into other files. The conversion records this boundary
explicitly; it does not silently discover other sessions or claim complete history.
The public MiniApp API cannot read the parent conversation or identify its log
file. Choose the source explicitly.

Chat sends only the context selected in TraceVista. Smart Context first reads
summaries and then requests original records. Images are excluded. The Agent API
accepts at most 100,000 UTF-16 code units per call; TraceVista uses a conservative
context allowance and checks the exact request length before invoking the host.
Oversized requests ask you to reduce the scope, rather than silently dropping evidence.

Every Chat request starts a fresh MiniApp-owned Agent session with the current
host model and the selected conversation context. This keeps old evidence from
leaking into later requests. Permission requests appear as explicit **Allow once**
and **Deny** choices; **Open Agent** shows the session in MiniMax. Questionnaires
are completed in that host tab. Unknown outcomes are never retried automatically.
TraceVista shows progress as Agent events arrive, then displays the final reply
when the turn finishes. Intermediate Agent commentary is kept out of the answer
and out of Smart Context's evidence-selection JSON.

## Data & access

- The viewer is bundled locally. Opening it does not upload a trajectory or load
  TraceVista's public examples. It does not read MiniMax credentials, private logs,
  runtime databases, or the parent conversation automatically.
- The MiniApp declares `agentAccess: ["session.run"]`. Chat asks a full MiniMax
  Agent to answer from the supplied evidence. That Agent retains its host tools
  and permissions; this is not an inference-only API. TraceVista asks it not to
  use tools, and never automatically approves a tool request.
- Clicking the conversion button inserts a prompt into the host draft after host
  confirmation. Only sending that draft starts the normal agent conversion,
  which reads the path you selected and writes the resulting files.
- Imported trajectory files stay in viewer memory. Chat history and settings are
  stored in MiniMax's private `context.dataDir`, not browser storage. Clearing a
  conversation removes its stored turns. Browser storage holds view preferences
  such as language and panel width. Refreshing the viewer requires reimporting
  the trajectory.
- Host model calls use host-managed credentials. Custom API calls go directly to
  the endpoint you configure and use your supplied key. Keys are memory-only by
  default; **Remember the key in this MiniApp** stores a custom key in the local
  plugin data file, not in an encrypted vault.
- No app-controlled outbound request is made until you call a model or follow
  an external link. Model traffic is sent to your selected host provider or
  custom endpoint. Header links may open `github.com` and `tracevista.pages.dev`.
- The Node entry serves only bundled assets and its allowlisted chat storage.
  It relies on MiniMax Code 3.1.2's authenticated loopback server and exposes no
  arbitrary file reader, proxy, shell runner or MCP server.

## Tested environment

The package targets the documented **MiniMax Code 3.1.2** contract at
[`MiniMax-Code-MiniApps@9269f35`](https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/tree/9269f35097fae982965e7e6e6876457de1faec73).
Automated checks cover package validation, the Node server, persistent storage,
synthetic MiniMax session extraction, and Agent API mocks for model selection,
events, final replies, cancellation and user interaction. The existing viewer and conversion
test suites remain required.

```sh
pnpm test:minimax-miniapp
pnpm test
pnpm build
pnpm build:minimax-miniapp
# Optional: use a checkout of the official MiniApps repository to validate the package.
node /path/to/MiniMax-Code-MiniApps/scripts/validate.mjs \
  integrations/minimax-miniapp/.build/tracevista
```

Actual installation, injected page APIs, authentication and model execution in a
running MiniMax Code app still require a host smoke test. They are not established
by the mocked tests. No MiniMax application was installed on the development Mac
when this integration was prepared.

## Source and license

[TraceVista](https://github.com/Superone77/TraceVista) is MIT licensed. The generated
package includes `LICENSE`, `THIRD_PARTY_NOTICES.md` and dependency notices under
`LICENSES/`. Runtime code is built from the shared viewer and canonical
`skills/tracevista-skill`; there is no separate fork of either.
