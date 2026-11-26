import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, terminals, theme, run, window, keys, exec, home, notify } from "herdr";

// The dev server is `ws local` (~/projects/dotfiles/bin/ws); this only shows it and calls start/stop.
// A space gets the controls when its repo's ws recipe has [dev.*] processes.
const WS = () => `${home()}/.local/bin/ws`;

export default class MyStatus extends View {
  init(_props, cx) {
    this.recipe = {};     // folder -> { root } when its repo's recipe has dev processes, else null
    this.listening = {};  // url -> bool
    this.busy = {};       // space id -> "start" | "stop"
    cx.timer.every(2000, (cx) => this.poll(cx));
    this.poll(cx);
  }

  // Data herdr does not push: whether a space's repo has dev processes, and whether the port answers.
  poll(cx) {
    const space = spaces().find((s) => s.active);
    if (!space) return;
    const dev = this.dev(space);
    cx.spawn(async (cx) => {
      if (space.folder && !space.machine && this.recipe[space.folder] === undefined) {
        this.recipe[space.folder] = null;
        const r = await exec(WS(), ["info"], { cwd: space.folder }).catch(() => ({ code: -1 }));
        // No recipe or not a checkout: ws exits non-zero. Anything else (e.g. too old a python) is worth a word.
        if (r.code !== 0 && r.stderr && !/no recipe|not inside a git checkout|has no origin remote/.test(r.stderr))
          notify({ title: "ws info failed", body: r.stderr.trim(), level: "error" });
        const info = Object.fromEntries((r.code === 0 ? r.stdout : "").split("\n").filter((l) => l.includes("="))
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
        this.recipe[space.folder] = info.dev ? { root: info.root } : null;
      }
      if (dev) {
        const port = dev.url.split(":").pop();
        const r = await exec("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"]);
        this.listening[dev.url] = r.code === 0 && r.stdout.trim() !== "";
      }
      cx.notify();
    });
  }

  // ws labels every dev terminal with its checkout (dev.worktree) and the url the first process listens on.
  dev(space) {
    const root = this.recipe[space.folder]?.root;
    const t = root && terminals().find((t) => t.state === "live" && t.labels?.["dev.worktree"] === root && t.labels?.["dev.url"]);
    return t ? { url: t.labels["dev.url"], app: t.labels["dev.app"] } : null;
  }

  local(space, action, cx) {
    this.busy[space.id] = action;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec(WS(), ["local", action], { cwd: space.folder, timeout: 60000 }).catch((e) => ({ code: -1, stderr: String(e) }));
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
    if (!space?.folder || !this.recipe[space.folder]) return null;
    const dev = this.dev(space);
    const busy = this.busy[space.id];
    const up = dev && this.listening[dev.url];
    const icon = (name, id, tip, onClick) =>
      h_flex().id(id).size(18).flex_none().items_center().justify_center().rounded(4).cursor_pointer()
        .hover((s) => s.bg(t.hover)).tooltip(tip)
        .on_click((_e, cx) => onClick(cx)).child(svg(`mods/my-status/${name}.svg`).size(11));

    const row = h_flex().h_full().gap(6).items_center();
    const dot = (bg) => div().size(6).flex_none().rounded(3).bg(bg);  // even size, like the agents dot: centres on the pixel grid
    if (busy || (dev && !up)) {
      return row.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().spin(900))
        .child(div().text_color(t.muted).child(busy === "stop" ? "stopping…" : `starting ${dev?.url.replace(/^https?:\/\//, "") ?? ""}`))
        .when(Boolean(dev) && busy !== "stop", (el) => el.child(icon("stop", "dev-stop", "Stop dev server", (cx) => this.local(space, "stop", cx))));
    }
    if (dev) {
      return row.child(dot(t.done))
        .child(div().id("dev-url").cursor_pointer().text_color(t.foreground).hover((s) => s.underline())
          .tooltip("Open in browser").on_click(() => exec("open", [dev.url])).child(dev.url.replace(/^https?:\/\//, "")))
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
