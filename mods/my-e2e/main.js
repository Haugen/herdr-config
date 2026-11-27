// Picks and starts e2e tests for one checkout: opened by my-status's e2e chip as a dialog with
// props { folder, root }. Tests and tag groups come from `ws e2e list` (the repo's ws recipe);
// the run itself is `ws e2e start`, which opens an "e2e" tab. Choices persist in shared "my-e2e".

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, notify, props, closeOverlay, shared, setShared, theme, checking } from "herdr";

const WS = () => `${home()}/.local/bin/ws`;
const PREFS = "my-e2e.prefs";   // { tags: [], target: "local" | "qa", headed: false }
const LISTS = "my-e2e.lists";   // folder -> last `ws e2e list` answer, shown at once next time

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default class E2E extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.folder = p.folder;
    this.list = shared(LISTS)?.[this.folder] ?? null;
    this.prefs = { tags: [], target: "local", headed: false, ...(shared(PREFS) ?? {}) };
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (checking()) return;
    cx.spawn(async (cx) => {
      const r = await exec(WS(), ["e2e", "list"], { cwd: this.folder, timeout: 180000 }).catch((e) => ({ code: -1, stderr: String(e) }));
      if (r.code === 0) {
        try {
          this.list = JSON.parse(r.stdout);
          setShared(LISTS, { ...(shared(LISTS) ?? {}), [this.folder]: this.list });
        } catch { this.error = "ws e2e list: not JSON"; }
      } else this.error = (r.stderr || r.stdout || "ws e2e list failed").trim().split("\n").pop();
      cx.notify();
    });
  }

  save(change, cx) {
    this.prefs = { ...this.prefs, ...change };
    setShared(PREFS, this.prefs);
    cx.notify();
  }

  // Products are the tags no group names; a hidden tag (one every test has) is not offered.
  groups() {
    const l = this.list;
    if (!l) return [];
    const hide = new Set(l.hide ?? []);
    const grouped = new Set(Object.values(l.groups ?? {}).flat());
    const seen = [];
    for (const t of l.tests) for (const tag of t.tags) if (!hide.has(tag) && !seen.includes(tag)) seen.push(tag);
    const count = (tag) => l.tests.filter((t) => t.tags.includes(tag)).length;
    const out = [{ name: "Products", tags: seen.filter((t) => !grouped.has(t)) }];
    for (const [name, tags] of Object.entries(l.groups ?? {})) out.push({ name, tags: tags.filter((t) => seen.includes(t)) });
    return out.filter((g) => g.tags.length).map((g) => ({ ...g, tags: g.tags.map((tag) => ({ tag, n: count(tag) })) }));
  }

  // Within a group any tag matches; across groups all must (Lönekollen paid with Svea).
  picked() {
    const tests = this.list?.tests ?? [];
    const sel = this.prefs.tags.filter((t) => tests.some((x) => x.tags.includes(t)));
    const byGroup = this.groups().map((g) => g.tags.map((x) => x.tag).filter((t) => sel.includes(t))).filter((g) => g.length);
    return { byGroup, tests: tests.filter((t) => byGroup.every((g) => g.some((tag) => t.tags.includes(tag)))) };
  }

  base() {
    return [...(this.prefs.target === "qa" ? ["--qa"] : []), ...(this.prefs.headed ? ["--headed"] : [])];
  }

  args() {
    const a = this.base();
    const { byGroup, tests } = this.picked();
    if (byGroup.length === 1) a.push("--tag", byGroup[0].join(","));
    else if (byGroup.length > 1) for (const t of tests) a.push("--grep", `${escape(t.title)}$`);
    return a;
  }

  start(args) {
    closeOverlay(props().overlay);
    exec(WS(), ["e2e", "start", ...args], { cwd: this.folder, timeout: 30000 })
      .then((r) => { if (r.code !== 0) notify({ title: "e2e did not start", body: (r.stderr || r.stdout).trim(), level: "error" }); })
      .catch((e) => notify({ title: "e2e did not start", body: String(e), level: "error" }));
  }

  render(cx) {
    const t = theme();
    const box = (on, round = false) => h_flex().size(15).flex_none().items_center().justify_center().rounded(round ? 8 : 4)
      .border_1().border_color(on ? t.accent : t.input).when(on, (el) => el.bg(t.accent))
      .when(on && !round, (el) => el.child(svg("mods/my-e2e/check.svg").size(11).text_color(t.accent_foreground)))
      .when(on && round, (el) => el.child(div().size(5).rounded(3).bg(t.accent_foreground)));
    const row = (id, on, label, hint, onClick, round = false) => h_flex().id(id).h(27).px(8).gap(9).items_center().rounded(6)
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => onClick(cx))
      .child(box(on, round)).child(div().flex_1().truncate().text_color(t.foreground).child(label))
      .child(div().text_size(11).text_color(t.dim).child(hint));
    const head = (text) => div().px(8).pt(8).pb(3).text_size(11).text_color(t.dim).child(text);
    const rule = () => div().h(1).mx(4).my(6).bg(t.border);
    const button = (id, label, primary, enabled, onClick) => h_flex().id(id).h(30).px(12).items_center().rounded(7).flex_none()
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).when(!enabled, (el) => el.opacity(0.45))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(() => onClick())).child(label);

    const total = this.list?.tests.length ?? 0;
    const sel = this.prefs.tags;
    const toggle = (tag, cx) => this.save({ tags: sel.includes(tag) ? sel.filter((x) => x !== tag) : [...sel, tag] }, cx);
    const { byGroup, tests } = this.picked();
    const n = byGroup.length ? tests.length : total;
    const groups = this.groups();

    // One column per group; a group's "All" clears only that group.
    const columns = h_flex().flex_none().items_start().gap(10);
    for (const g of groups) {
      const mine = g.tags.map((x) => x.tag);
      const any = !sel.some((x) => mine.includes(x));
      const col = v_flex().flex_1().min_w(0).child(head(g.name))
        .child(row(`all-${g.name}`, any, "All", "", (cx) => this.save({ tags: sel.filter((x) => !mine.includes(x)) }, cx)));
      for (const { tag, n } of g.tags) col.child(row(`tag-${tag}`, sel.includes(tag), tag, String(n), (cx) => toggle(tag, cx)));
      columns.child(col);
    }

    const list = v_flex().id("e2e-tests").flex_1().min_h(0).overflow_y_scrollbar();
    for (const x of byGroup.length ? tests : this.list?.tests ?? []) {
      list.child(h_flex().flex_none().h(24).px(8).gap(10).items_center()
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(x.title))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(x.file.split("/").pop().replace(/\.e2e\.ts$/, ""))));
    }
    if (this.list && byGroup.length && !tests.length) list.child(div().px(8).py(4).text_color(t.dim).child("No test matches all the groups."));

    const body = !this.list
      ? div().flex_1().px(8).py(10).text_color(this.error ? t.blocked : t.dim).child(this.error ?? "Reading the tests…")
      : v_flex().flex_1().min_h(0)
        .child(columns)
        .child(rule())
        .child(head(n === 1 ? "Runs 1 test" : `Runs ${n} tests`))
        .child(list)
        .when(Boolean(this.error), (el) => el.child(div().px(8).pt(6).text_size(11).text_color(t.blocked).child(this.error)));

    return v_flex().id("my-e2e").size_full().min_h(0).p(10).bg(t.popover).text_size(13)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key !== "enter" || !this.list || n === 0) return;
        cx.stop_propagation();
        this.start(this.args());
      })
      .child(h_flex().px(8).pt(2).pb(4).items_center()
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("E2E tests"))
        .child(div().text_size(11).text_color(t.dim).child("Enter runs · Esc closes")))
      .child(body)
      .child(rule())
      .child(h_flex().flex_none().gap(4).items_center()
        .child(div().w(96).child(row("local", this.prefs.target === "local", "Local", "", (cx) => this.save({ target: "local" }, cx), true)))
        .child(div().w(80).child(row("qa", this.prefs.target === "qa", "QA", "", (cx) => this.save({ target: "qa" }, cx), true)))
        .child(div().w(110).child(row("headed", this.prefs.headed, "Headed", "", (cx) => this.save({ headed: !this.prefs.headed }, cx))))
        .child(div().flex_1())
        .child(button("failed", "Last failed", false, Boolean(this.list), () => this.start([...this.base(), "--last-failed"])))
        .child(button("run", n === 1 ? "Run 1 test" : `Run ${n} tests`, true, Boolean(this.list) && n > 0, () => this.start(this.args()))));
  }
}
