# Install the TraceVista skill in Codex

The plugin installation is documented in
[Agent integrations](../docs/AGENT-INTEGRATIONS.md#codex).
To install only the native skill, use this alternative.

1. Keep a checkout of this repository, or use the small package produced by
   `scripts/package-agent-plugin.mjs`.
2. Copy `skills/tracevista-skill` into `~/.agents/skills/tracevista-skill`.
   For a single project, use `<project>/.agents/skills/tracevista-skill`.
3. Start a new Codex session and ask it to use `tracevista-skill`.

From the repository root, on macOS or Linux:

```sh
mkdir -p "$HOME/.agents/skills"
test ! -e "$HOME/.agents/skills/tracevista-skill" &&
  cp -R skills/tracevista-skill "$HOME/.agents/skills/tracevista-skill"
```

An existing skill is left untouched. To update, compare or back up the existing
copy, then replace it with the new `skills/tracevista-skill` directory.
Choose either the plugin or standalone skill installation to avoid duplicate skills.

Example request:

```text
Use tracevista-skill to convert /absolute/path/to/session.jsonl into a complete
.agent-state.json and import it into https://tracevista.pages.dev/ in my browser.
```

The scripts need Python 3.10+. Skill installation does not install or start the
viewer. See [Codex skills documentation](https://developers.openai.com/codex/skills/).
