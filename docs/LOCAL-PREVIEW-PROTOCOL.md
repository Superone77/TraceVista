# Local preview import protocol

For maintainers of the viewer and of `skills/tracevista-skill/scripts/create_view.py`. Agents using the skill do not need this.

The local page creates a full-viewport iframe whose URL fragment contains
`tracevista-import=<32–128 hexadecimal characters>&source=<encoded local origin>`.
No trace bytes appear in the URL. Register the parent's message listener before starting
navigation. The frame receiver captures the fragment before clearing it.

Messages carry `type` and `token`:

1. Viewer → parent: `tracevista:ready`.
2. Parent → viewer: `tracevista:import`, with the complete `json` string.
3. Viewer → parent: `tracevista:loaded`, or `tracevista:error` with a fixed error code.

Sender verifies `event.source === iframe.contentWindow`, exact viewer origin and token;
JSON is sent only to the exact target origin. Receiver uses its parent when framed, otherwise
its opener for legacy flows; it checks that peer, the declared local source origin and token.
Only an explicit valid import fragment activates the receiver. The receiver accepts one
matching import, runs the ordinary graph parser and then acknowledges. Pending imports
time out after 30 seconds. Failures do not send raw exception text.

Allowed source origins remain `null` for legacy local files and HTTP(S) loopback origins
`localhost`, `127.0.0.1` and `[::1]`. A null-origin legacy peer receives only status replies
using `*`; trajectory messages always have a fixed target origin. The embedded engine must
allow framing by the local helper, and the helper's CSP must allow that engine origin.
