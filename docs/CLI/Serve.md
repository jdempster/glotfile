# `glotfile serve`

Starts the local web UI and opens your browser. This is the **default command** — `glotfile` on its own does the same thing.

```bash
glotfile
glotfile serve
```

It binds a server to `127.0.0.1`, prints the URL, and opens it. If there's no `glotfile.json` in the current directory, it starts from defaults and writes the file on your first edit.

## Options

| Option | Description |
|---|---|
| `--file`, `-f <path>` | Use a state file other than `./glotfile.json`. |
| `--dev` | Developer mode for working on Glotfile itself (used by `npm run dev`). |

```bash
glotfile serve --file packages/app/glotfile.json
```

> **Note:** Local only — the server binds to `127.0.0.1` — it is not exposed to your network. Everything stays on your machine except the AI calls you trigger.

## Related

- Quick Start · Web UI Overview · Installation
