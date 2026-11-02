# Notes — a brief

Build a Herdr app mod (`mods/notes/main.js`, `mod.json`, `place: none`) that writes markdown notes
per agent, shows them rendered, and takes pasted pictures.

## What it builds

- Files only: `~/.config/herdr-app/notes/<agent>/<name>.md` and `notes/images/`. No database.
- The agent key is `focused().agent` with non-alphanumerics replaced by `_` (`mac-mini/t1` →
  `mac-mini_t1`), `shared` when nothing has focus. Switching agents switches folders; an open note
  keeps the folder it was opened from, so a debounced save cannot land in the wrong one.
- One note open at a time: `写` (a `TextareaState`, soft wrap on, height from `on_size_change`) and
  `读` (`TextView.markdown`, with `![…](…)` split out and drawn by `image()`).

## What you see

A header (back, name, `写/读`, `＋`, agent label), then either the list of notes, the textarea, or the
rendered note. Footer: the save state or the last picture message, and `关闭` when it is a dialog.

## Built from

`gpui-kit` (`div`, `image`), `gpui-base` (`v_flex`, `h_flex`, `Textarea`, `TextareaState`,
`TextView`), `herdr` (`agents`, `focused`, `appHome`, `exec`, `theme`, `props`, `openOverlay`,
`closeOverlay`).

## Watch out

- `Textarea` needs an explicit height: with `size_full()` inside a flex row it draws nothing. Take
  the height from `on_size_change` on its wrapper.
- The sandbox has no `TextDecoder` and `fs.readFile` returns bytes; read text with `readTextFile` or
  keep to `fs.readFile(path, "utf8")` for files you wrote yourself as text.
- `image()` resolves against `~/.config/herdr-app`; a picture is measured (ffprobe) so the preview can
  fit it to the column without stretching.
- Clipboard images are WebP under omp; GDI+ cannot read them, so use ffmpeg before `SetImage` and
  before saving a dropped file.

## Done when

`herdr-app check mods/notes` passes; a note written in the panel appears on disk within a second; a
pasted picture lands in `notes/images/` and renders in `读`; switching agents shows a different list.
