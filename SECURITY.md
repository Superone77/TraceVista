# Security

## Report a vulnerability

Use [GitHub's private vulnerability report](https://github.com/Superone77/TraceVista/security/advisories/new) for security issues in TraceVista. Include the affected commit or deployment URL, steps to reproduce, the expected and observed behavior, and the potential impact. Use a small synthetic trajectory where possible. Do not post API keys, private trajectories, or an exploit containing other people's data in a public issue.

Security fixes target the current `main` branch. Include your version when reporting an older deployment so maintainers can determine whether the issue still exists. Maintainers will investigate through the private report and coordinate a fix and disclosure there.

## API keys and browser storage

- **Saving a key is opt-in.** By default, the key stays in page memory. Selecting **Remember the key in this browser** saves it in this site's `localStorage`, under `atlas-chat-settings`. This is plaintext browser storage, not a cookie or an encrypted vault. Scripts running on the same origin and software with access to the browser profile can read it.
- **The configured API receives the key.** Model-list and chat requests go directly from the browser to the selected API base URL. The key is sent in an authentication header, not through a TraceVista backend. Changing the provider or base URL clears the key field. Provider requests omit browser cookies and reject redirects.
- **Model discovery can run before you send a question.** For supported providers, entering a key can automatically request the model list. **Test connection** sends a short test prompt without trajectory data.
- **To remove a saved key**, clear the key field and turn off **Remember the key in this browser**. Turning off the checkbox removes it from saved settings but leaves the current in-memory value available until you clear it or reload. To remove all saved settings and conversations, close TraceVista tabs and clear site data for that origin in your browser. If a key was exposed, revoke it with the API provider; clearing browser data does not revoke it.

Use a provider and base URL you trust. Use HTTPS for remote endpoints; HTTP support is intended for local servers. A self-hosted deployment has its own browser storage, separate from `tracevista.pages.dev`.

## Trajectories, chat, and exports

Importing a local JSON file reads it in the browser. The import does not upload the file to TraceVista. Opening a bundled example downloads its public data from the site.

When you ask a question, the selected context is sent to your configured model API. **Smart context** first sends node summaries and a record directory, then sends the records selected by the model in a second request. Other context modes can send larger portions of the trajectory. Review the context preview before sending sensitive material. Supported image payloads are removed from chat requests; text is not automatically scrubbed for secrets.

Conversations are saved automatically in this origin's `localStorage`, keyed by trajectory title. Use **Clear conversation** to clear the current conversation. Settings and input allowances are also saved locally, even when key storage is off.

Conversation and context exports do not include the API connection settings. They can still contain sensitive text from questions, model replies, and trajectory records, including secrets already present in those records. Inspect exported files before sharing them.
