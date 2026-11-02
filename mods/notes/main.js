// Notes: markdown files in ~/.config/herdr-app/notes, written with a live preview, pictures pasted
// straight into the text. Nothing but those files is stored, so they are yours to edit anywhere.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, Textarea, TextareaState, TextView } from "gpui-base";
import { agents, focused, appHome, exec, theme, window, props, openOverlay, closeOverlay } from "herdr";
import * as fs from "fs/promises";

const BASE = () => appHome() + "\\notes";
const IMAGES = () => BASE() + "\\images";
// One folder per agent: the notes list belongs to whoever is in front.
const keyOf = () => String(focused()?.agent ?? "shared").replace(/[^A-Za-z0-9_.-]+/g, "_");
const dirFor = (key) => BASE() + "\\" + key;
const SAVE_MS = 700;

const stamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
};

const ps = (p) => "'" + String(p).replace(/'/g, "''") + "'";

// "![alt](path)" pieces, so pictures can be drawn with image() while the rest stays markdown.
function split(text) {
  const out = [];
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let at = 0, m;
  while ((m = re.exec(String(text)))) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ image: m[2].replace(/^<|>$/g, "").trim(), alt: m[1] });
    at = m.index + m[0].length;
  }
  if (at < String(text).length) out.push({ text: text.slice(at) });
  return out;
}

export default class Notes extends View {
  init(_props, cx) {
    this.notes = [];      // [{ name, at }]
    this.note = null;     // the open note's file name
    this.text = "";       // what the editor holds
    this.view = "read";  // "write" | "read"
    this.state = null;    // TextareaState of the open note
    this.pasted = null;   // the last pasted picture, while it is being inserted
    this.agent = keyOf(); // whose notes these are
    this.noteAgent = this.agent;
    this.list(cx);
    // The folder is also edited outside; a cheap re-read keeps the list honest.
    cx.timer.every(4000, (cx) => { if (!this.note) this.list(cx); });
  }

  async list(cx) {
    const key = this.agent;
    try {
      await fs.mkdir(dirFor(key), { recursive: true });
      const names = (await fs.readdir(dirFor(key))).filter((n) => n.endsWith(".md"));
      if (this.agent === key) this.notes = names.sort().reverse().map((name) => ({ name }));
    } catch { if (this.agent === key) this.notes = []; }
    cx.notify();
  }

  async open(name, cx) {
    this.release();
    this.note = name;
    this.noteAgent = this.agent;
    this.view = "write";
    try {
      this.text = (await fs.readFile(dirFor(this.noteAgent) + "\\" + name, "utf8")) || "";
      this.state = TextareaState.new({ value: this.text, rows: 18 });
      try { this.state.set_soft_wrap(true); this.state.focus(); } catch { /* widths settle on their own */ }
      this.state.on("change", (_e, cx) => { this.text = this.state.value(); this.save(cx); cx.notify(); });
      this.state.on("paste_other", (_e, cx) => this.pasteImage(cx));
      this.measure(this.text, cx);
    } catch { this.text = ""; this.state = null; }
    cx.notify();
  }

  release() {
    if (this.state) { try { this.state.release(); } catch { /* already gone */ } }
    this.state = null;
  }

  async save(cx) {
    const name = this.note, text = this.text;
    if (!name) return;
    this.pending = Date.now();
    const at = this.pending;
    cx.timer.after(SAVE_MS, async (cx) => {
      if (this.note !== name || this.pending !== at) return;
      try { await fs.mkdir(dirFor(this.noteAgent), { recursive: true }); await fs.writeFile(dirFor(this.noteAgent) + "\\" + name, text); } catch { /* keep editing */ }
      this.saved = true;
      cx.notify();
    });
  }

  async create(cx) {
    const name = "note-" + stamp() + ".md";
    await fs.mkdir(dirFor(this.agent), { recursive: true }).catch(() => {});
    await fs.writeFile(dirFor(this.agent) + "\\" + name, "").catch(() => {});
    await this.list(cx);
    this.open(name, cx);
  }

  // The clipboard's picture, saved beside the notes and appended as markdown. GDI+ writes the PNG.
  async pasteImage(cx) {
    this.pasted = "正在从剪贴板取图…";
    cx.notify();
    try {
      await fs.mkdir(IMAGES(), { recursive: true });
      const file = IMAGES() + "\\img-" + stamp() + ".png";
      const cmd = "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;"
        + " if ([System.Windows.Forms.Clipboard]::ContainsImage()) {"
        + " $i=[System.Windows.Forms.Clipboard]::GetImage(); $i.Save(" + ps(file) + ", [System.Drawing.Imaging.ImageFormat]::Png); $i.Dispose(); 'ok' }"
        + " else { 'none' }";
      const r = await exec("powershell", ["-NoProfile", "-Sta", "-Command", cmd]);
      if (!/ok/.test(r.stdout)) { this.pasted = "剪贴板里没有图片。"; cx.notify(); return; }
      const rel = "notes/images/img-" + file.split("img-")[1];
      this.insert("\n![](" + rel + ")\n", cx);
      this.pasted = "已插入 " + rel;
    } catch (e) {
      this.pasted = "插图失败：" + String(e?.message ?? e).slice(0, 80);
    }
    cx.notify();
    cx.timer.after(2500, (cx) => { this.pasted = null; cx.notify(); });
  }

  // A picture's size, so the preview can fit it to the column without stretching it.
  async measure(text, cx) {
    this.sizes = this.sizes ?? {};
    for (const part of split(text)) {
      const rel = part.image;
      if (!rel || this.sizes[rel]) continue;
      const abs = appHome() + "\\" + rel.replace(/\//g, "\\");
      const r = await exec("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", abs]).catch(() => null);
      const [w, h] = String(r?.stdout ?? "").trim().split(",").map(Number);
      if (w > 0 && h > 0) this.sizes[rel] = { w, h };
    }
    cx.notify();
  }

  box(rel) {
    const s = this.sizes?.[rel], W = this.wide ?? 320;
    if (!s) return { w: W, h: 200 };
    const k = Math.min(W / s.w, 1);
    return { w: Math.round(s.w * k), h: Math.round(s.h * k) };
  }

  insert(add, cx) {
    const next = (this.text ?? "").replace(/\s+$/, "") + add;
    this.text = next;
    if (this.state) this.state.set_value(next);
    if (cx) this.measure(next, cx);
  }

  // A picture dropped from the desktop lands in notes/images and is appended the same way.
  async dropImage(path, cx) {
    try {
      await fs.mkdir(IMAGES(), { recursive: true });
      const name = "img-" + stamp() + "." + (path.split(".").pop() || "png");
      const args = ["-y", "-loglevel", "error", "-i", path, IMAGES() + "\\" + name];
      const r = await exec("ffmpeg", args).catch(() => null);
      if (!r || r.code !== 0) { this.pasted = "这个图片读不了。"; cx.notify(); return; }
      this.insert("\n![](notes/images/" + name + ")\n", cx);
      this.pasted = "已插入 notes/images/" + name;
      this.save(cx);
      cx.notify();
    } catch (e) { this.pasted = String(e?.message ?? e); cx.notify(); }
  }

  render(cx) {
    const t = theme();
    const inPane = !props()?.overlay;
    const key = keyOf();
    if (key !== this.agent) {
      this.release();
      this.note = null;
      this.agent = key;
      this.notes = [];
      this.list(cx);
    }
    const who = agents().find((a) => a.address === focused()?.agent) ?? null;
    const button = (id, label, action) => h_flex().id(id).h(24).px(8).flex_none().items_center().rounded(6)
      .border(1).border_color(t.border).bg(t.chrome).text_size(11.5).text_color(t.dim)
      .hover((x) => x.bg(t.hover).text_color(t.foreground)).on_click(action).child(label);

    const head = h_flex().h(34).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .when(Boolean(this.note), (el) => el.child(h_flex().id("notes-back").h(24).px(6).flex_none().items_center().rounded(6)
        .text_size(11.5).text_color(t.dim).hover((x) => x.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { this.release(); this.note = null; this.list(cx); }).child("←")))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold()
        .child(this.note ? this.note.replace(/\.md$/, "") : "Notes"))
      .when(!this.note, (el) => el.child(div().max_w(150).truncate().text_size(10.5).text_color(t.dim)
        .child(who ? "· " + (who.space_name ?? who.address) : "· 无 agent")))
      .when(Boolean(this.note), (el) => el.child(h_flex().h(24).flex_none().rounded(6).bg(t.raised).p(1).gap(1)
        .child(h_flex().id("notes-write").h(22).px(8).items_center().rounded(5).text_size(11).cursor_pointer()
          .bg(this.view === "write" ? t.selected : t.raised).text_color(this.view === "write" ? t.foreground : t.dim)
          .on_click((_e, cx) => { this.view = "write"; cx.notify(); }).child("写"))
        .child(h_flex().id("notes-read").h(22).px(8).items_center().rounded(5).text_size(11).cursor_pointer()
          .bg(this.view === "read" ? t.selected : t.raised).text_color(this.view === "read" ? t.foreground : t.dim)
          .on_click((_e, cx) => { this.view = "read"; cx.notify(); }).child("读"))))
      .child(button("notes-new", "＋", (_e, cx) => this.create(cx)))
      .when(inPane && !this.note, (el) => el.child(button("notes-open", "打开", (_e, cx) => openOverlay({ mod: "notes", kind: "dialog", width: 620, height: 660 }))));

    if (!this.note) {
      const row = (n) => h_flex().id("note-" + n.name).h(28).flex_none().px(10).gap(8).items_center().cursor_pointer()
        .text_size(12).text_color(t.foreground).hover((x) => x.bg(t.hover))
        .on_click((_e, cx) => this.open(n.name, cx))
        .child(div().flex_1().min_w(0).truncate().child(n.name.replace(/\.md$/, "")));
      return v_flex().id("notes").size_full().min_w(0).bg(t.surface).text_color(t.foreground).child(head)
        .child(this.notes.length
          ? v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(4).children(this.notes.map(row))
          : v_flex().p(12).child(div().text_size(11.5).text_color(t.dim).child("还没有笔记，点「新建」开始。")))
        .when(inPane, (el) => el.child(h_flex().flex_none().px(10).py(6).border_t(1).border_color(t.border)
          .child(div().max_w(220).truncate().text_size(10.5).text_color(t.dim).child("文件在 " + dirFor(this.agent)))));
    }

    const wide = this.wide;
    const body = this.view === "write"
      ? (this.state
        ? div().flex_1().min_h(0).min_w(0).overflow_hidden().p(8).on_size_change((size, cx) => {
          const h = Math.max(160, Math.round(size.height - 16));
          if (Math.abs((this.bodyH ?? 0) - h) > 4) { this.bodyH = h; cx.notify(); }
        }).child(Textarea.new(this.state).w_full().h(this.bodyH ?? 420))
        : div().p(12).child("…"))
      : v_flex().flex_1().min_h(0).min_w(0).overflow_y_scrollbar().p(12).gap(8)
        .on_size_change((size, cx) => {
          const w = Math.max(120, Math.round(size.width - 24));
          if (Math.abs((this.wide ?? 0) - w) > 4) { this.wide = w; cx.notify(); }
        })
        .children(split(this.text).map((part, i) => {
          if (!part.image) return TextView.markdown("np-" + i, part.text);
          const b = this.box(part.image);
          return div().id("np-" + i).child(image(part.image).w(b.w).h(b.h));
        }));

    return v_flex().id("notes").size_full().min_w(0).bg(t.surface).text_color(t.foreground).child(head)
      .child(div().flex_1().min_h(0).when(true, (el) => el.child(body)))
      .child(h_flex().flex_none().px(10).py(5).gap(8).border_t(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.dim)
          .child(this.pasted ?? (this.saved ? "已保存" : "编辑即保存")))
        .when(!inPane, (el) => el.child(h_flex().id("notes-close").h(22).px(8).flex_none().items_center().rounded(6)
          .text_size(11.5).text_color(t.dim).hover((x) => x.bg(t.hover).text_color(t.foreground))
          .on_click((_e, _cx) => closeOverlay(props().overlay)).child("关闭"))));
  }
}
