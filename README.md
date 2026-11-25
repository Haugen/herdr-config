# herdr-config

My Herdr desktop app config. This repo *is* `~/.config/herdr-app`; `.gitignore` whitelists my files and
leaves everything Herdr writes or regenerates untracked.

- `settings.json`, `keys.json` — look and keybindings.
- `layouts/my-main.json` — clone of Herdr's `main`, with `my-spaces` as the sidebar list and `my-status` as the status bar.
- `mods/my-spaces/` — clone of `spaces`: name and branch on two lines, so neither truncates the other.
- `mods/my-status/` — clone of `workspace-status` plus the local dev server: open, start, stop.
  It calls `~/.claude/skills/local/local.sh` (a personal Claude Code skill, not in this repo).

Herdr overwrites its shipped layouts and mods on every start, so only edit `my-*` clones
(`herdr-app do mod.clone '{"name":"…","as":"my-…"}'`, same for `layout.clone`). After an edit:
`herdr-app check mods/my-…` and `herdr-app status`.

## New machine

Start Herdr once so the folder exists, then:

```sh
cd ~/.config/herdr-app
git init -b main
git remote add origin git@github.com:Haugen/herdr-config.git
git fetch origin && git checkout -f main
herdr-app do layout.switch '{"name":"my-main"}'
```
