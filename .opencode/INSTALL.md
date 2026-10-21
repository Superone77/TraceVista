# Install the TraceVista skill in OpenCode

OpenCode reads native `SKILL.md` directories. Use the shared skill directly.

From a checkout of TraceVista, on macOS or Linux:

```sh
mkdir -p "$HOME/.config/opencode/skills"
test ! -e "$HOME/.config/opencode/skills/tracevista-skill" &&
  cp -R skills/tracevista-skill "$HOME/.config/opencode/skills/tracevista-skill"
```

For a single project, copy it to
`<project>/.opencode/skills/tracevista-skill` instead.
An existing skill is left untouched; compare or back it up before replacing it.
Start a new session and ask:

```text
Use tracevista-skill to convert /absolute/path/to/session.jsonl into a complete
.agent-state.json and import it into https://tracevista.pages.dev/ in my browser.
```

The scripts need Python 3.10+. This installs the conversion workflow; it does not
add an OpenCode session-format adapter. Supported inputs are listed in
[Agent integrations](../docs/AGENT-INTEGRATIONS.md).

See [OpenCode's native skill discovery](https://opencode.ai/docs/skills/).
