import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, terminals, theme, run, window, keys, exec, home, notify, openOverlay, readTextFile, shared } from "herdr";

// The dev server is `ws local` (~/projects/dotfiles/bin/ws); this only shows it and calls start/stop.
// A space gets the controls when its repo's ws recipe has [dev.*] processes, and an e2e chip
// (my-e2e's popup, `ws e2e`) when it has [e2e].
const WS = () => `${home()}/.local/bin/ws`;

export default class MyStatus extends View {
  init(_props, cx) {
    this.recipe = {};     // folder -> { root, dev, e2e, e2eStatus } when its repo's recipe has dev or e2e, else null
    this.e2e = {};        // root -> the last `ws e2e run` status (gitdir/e2e-status.json)
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
        this.recipe[space.folder] = info.dev || info.e2e
          ? { root: info.root, dev: Boolean(info.dev), e2e: info.e2e || null, e2eStatus: info.e2e_status || null } : null;
      }
      const rec = space.folder && this.recipe[space.folder];
      if (rec?.e2eStatus) {
        let st = null;
        try { st = JSON.parse((await readTextFile(rec.e2eStatus).catch(() => null)) ?? "null"); } catch { st = null; }
        // Its tab closed mid-run: the runner died without writing "done".
        if (st?.state === "running" && (await exec("kill", ["-0", String(st.pid)])).code !== 0) st = { ...st, state: "done", code: -1 };
        if (this.e2e[rec.root]?.state === "running" && st?.state === "done") this.announce(st);
        this.e2e[rec.root] = st;
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
    if (!space?.folder || !this.recipe[space.folder]?.dev) return null;
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

  e2eResult(st) {
    const s = st.summary;
    if (st.code === 130 || st.code === -1) return { label: "e2e stopped", color: "dim", level: "warning", title: "E2E run stopped" };
    if (s && s.failed) return { label: `e2e ${s.failed} failed`, color: "ansi1", level: "error", title: "E2E tests failed" };
    if (st.code !== 0) return { label: "e2e failed", color: "ansi1", level: "error", title: "E2E run failed" };
    return { label: s ? `e2e ${s.passed}/${s.executed}` : "e2e passed", color: "ansi2", level: "success", title: "E2E tests passed" };
  }

  announce(st) {
    const r = this.e2eResult(st);
    const s = st.summary;
    const counts = s ? `${s.passed} passed, ${s.failed} failed${s.flaky ? `, ${s.flaky} flaky` : ""} · ` : "";
    notify({ title: r.title, body: `${counts}${st.target === "qa" ? "QA" : "local"}`, level: r.level });
  }

  // Sized to the last test list the dialog saw: the tallest group column plus every test.
  e2eHeight(folder) {
    const l = shared("my-e2e.lists")?.[folder];
    if (!l) return 520;
    const hide = new Set(l.hide ?? []);
    const tags = [...new Set(l.tests.flatMap((x) => x.tags).filter((x) => !hide.has(x)))];
    const grouped = new Set(Object.values(l.groups ?? {}).flat());
    const tallest = Math.max(tags.filter((x) => !grouped.has(x)).length, ...Object.values(l.groups ?? {}).map((g) => g.filter((x) => tags.includes(x)).length));
    return Math.min(720, 170 + (tallest + 1) * 27 + Math.min(l.tests.length, 14) * 24);
  }

  e2eStatus(space, t) {
    const rec = space?.folder && this.recipe[space.folder];
    if (!rec?.e2e) return null;
    const st = this.e2e[rec.root];
    const dot = (bg) => div().size(6).flex_none().rounded(3).bg(bg);
    const open = () => openOverlay({ mod: "my-e2e", kind: "dialog", width: 600, height: this.e2eHeight(space.folder), props: { folder: space.folder, root: rec.root } });
    const chip = (id, tip, onClick) => h_flex().id(id).h_full().gap(6).items_center().cursor_pointer().tooltip(tip)
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => onClick(cx));
    if (st?.state === "running") {
      const term = terminals().find((x) => x.state === "live" && x.labels?.["e2e.worktree"] === rec.root);
      return h_flex().h_full().gap(6).items_center()
        .child(chip("e2e", "Show the run", () => term && run("pane.focus", { terminal: term.address }))
          .child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().spin(900))
          .child(`e2e ${st.target === "qa" ? "on QA" : "running"}`))
        .child(h_flex().id("e2e-stop").size(18).flex_none().items_center().justify_center().rounded(4).cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip("Stop the e2e run")
          .on_click(() => exec(WS(), ["e2e", "stop"], { cwd: space.folder })).child(svg("mods/my-status/stop.svg").size(11)));
    }
    if (st?.state === "done") {
      const r = this.e2eResult(st);
      return chip("e2e", "Run e2e tests", open).child(dot(t[r.color])).child(r.label);
    }
    return chip("e2e", "Run e2e tests", open).child(dot(t.dim)).child("e2e");
  }

  render() {
    const t = theme();
    const space = spaces().find((s) => s.active);
    const list = agents();
    const needs = list.filter((a) => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const dev = this.devStatus(space, t);
    const e2e = this.e2eStatus(space, t);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} ${list.length === 1 ? "agent" : "agents"}`)
        .when(needs > 0, (el) => el.child(div().text_color(t.blocked).child(`· ${needs} ${needs === 1 ? "needs" : "need"} you`))))
      .child(div().flex_1())
      .when(Boolean(e2e), (el) => el.child(e2e))
      .when(Boolean(dev), (el) => el.child(dev))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
