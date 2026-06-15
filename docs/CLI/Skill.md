# `glotfile skill`

Installs the **Claude Code skill** for managing glotfile into `./.claude/skills/glotfile/`, so Claude Code knows how to drive glotfile in your project — translating, exporting, linting, and editing the catalog.

```bash
glotfile skill
```

## Options

| Option | Description |
|---|---|
| `--print` | Write `SKILL.md` to stdout instead of installing it. |
| `--force` | Overwrite an existing installed skill. |

Run it once per project. With the skill installed, you can ask Claude Code to manage translations directly and it will use the glotfile CLI for you.

## Related

- CLI Overview · translate
