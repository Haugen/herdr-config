import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, terminals, theme, run, window, keys, exec, home, notify } from "herdr";

// The dev server is ~/.claude/skills/local/local.sh; this only shows it and calls start/stop.
const LOCAL = () => `${home()}/.claude/skills/local/local.sh`;
const WEB = "apps/ratsit-web/Ratsit.Web";

export default class MyStatus extends View {
  init(_props, cx) {
    this.hasWeb = {};     // folder -> bool
    this.listening = {};  // url -> bool
    this.busy = {};       // space id -> "start" | "stop"
    cx.timer.every(2000, (cx) => this.poll(cx));
    this.poll(cx);
  }

  // Data herdr does not push: whether a space's folder has ratsit-web, and whether the port answers.
  poll(cx) {
    const space = spaces().find((s) => s.active);
    if (!space) return;
    const dev = this.dev(space);
    cx.spawn(async (cx) => {
      if (space.folder && this.hasWeb[space.folder] === undefined) {
        const r = await exec("test", ["-d", `${space.folder}/${WEB}`]);
        this.hasWeb[space.folder] = r.code === 0;
      }
      if (dev) {
        const port = dev.url.split(":").pop();
        const r = await exec("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"]);
        this.listening[dev.url] = r.code === 0 && r.stdout.trim() !== "";
      }
      cx.notify();
    });
  }

  dev(space) {
    const web = terminals().find((t) => t.state === "live" && t.labels?.["herdr.space"] === space.id && t.labels?.["dev.role"] === "web");
    return web ? { url: web.labels["dev.url"], app: web.labels["dev.app"] } : null;
  }

  local(space, action, cx) {
    this.busy[space.id] = action;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec(LOCAL(), action === "start" ? ["start", "--space", space.id] : ["stop"], { cwd: space.folder, timeout: 60000 });
      if (r.code !== 0) notify({ title: `Dev server ${action} failed`, body: (r.stderr || r.stdout).trim(), level: "error" });
      delete this.busy[space.id];
      cx.notify();
    });
  }

  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  devStatus(space, t) {
    if (!space?.folder || !this.hasWeb[space.folder]) return null;
    const dev = this.dev(space);
    const busy = this.busy[space.id];
    const up = dev && this.listening[dev.url];
    const icon = (name, id, tip, onClick) =>
      h_flex().id(id).size(18).flex_none().mt(3).items_center().justify_center().rounded(4).cursor_pointer()
        .hover((s) => s.bg(t.hover)).tooltip(tip)
        .on_click((_e, cx) => onClick(cx)).child(svg(`mods/my-status/${name}.svg`).size(11));

    const row = h_flex().h_full().gap(6).items_center();
    // Glyphs sit below the line box centre; a centred item moves by half its margin, so mt(3) = 1.5px.
    const dot = (bg) => div().size(7).flex_none().mt(3).rounded(4).bg(bg);
    if (busy || (dev && !up)) {
      return row.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().mt(3).spin(900))
        .child(div().text_color(t.muted).child(busy === "stop" ? "stopping…" : `starting ${dev?.url.replace("https://", "") ?? ""}`))
        .when(Boolean(dev) && busy !== "stop", (el) => el.child(icon("stop", "dev-stop", "Stop dev server", (cx) => this.local(space, "stop", cx))));
    }
    if (dev) {
      return row.child(dot(t.done))
        .child(div().id("dev-url").cursor_pointer().text_color(t.foreground).hover((s) => s.underline())
          .tooltip("Open in browser").on_click(() => exec("open", [dev.url])).child(dev.url.replace("https://", "")))
        .child(icon("stop", "dev-stop", "Stop dev server", (cx) => this.local(space, "stop", cx)));
    }
    return row.child(dot(t.dim))
      .child("dev server")
      .child(icon("play", "dev-start", "Start dev server", (cx) => this.local(space, "start", cx)));
  }

  render() {
    const t = theme();
    const space = spaces().find((s) => s.active);
    const list = agents();
    const needs = list.filter((a) => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const dev = this.devStatus(space, t);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} ${list.length === 1 ? "agent" : "agents"}`)
        .when(needs > 0, (el) => el.child(div().text_color(t.blocked).child(`· ${needs} ${needs === 1 ? "needs" : "need"} you`))))
      .child(div().flex_1())
      .when(Boolean(dev), (el) => el.child(dev))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
