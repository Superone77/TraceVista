# Project conventions

- Use plain language. Keep the viewer agent-neutral and task-neutral; put source-specific interpretation in adapters/examples.
- Preserve raw event text, IDs, call/result pairing and source attachments. Labels and inferred relationships need cited evidence.
- Chronology and code ancestry are separate. Review PASS is not correctness or performance evidence.
- Example traces are private research data. Keep credentials and ordinary local imports out of Git and production builds. Only examples explicitly approved for this repository belong under viewer/public/examples/. The Pi example is one complete JSON export; do not add separate original experiment files.
- Run `pnpm test` and `pnpm build` for relevant changes. Do not claim a model/benchmark ran when only conversion or UI tests ran.
