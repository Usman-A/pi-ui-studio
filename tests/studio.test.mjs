/**
 * Studio behaviour tests.
 *
 * Driven through the public surface a host sees: the factory, the registered
 * commands, the registered tools, and the lifecycle hooks. No private state is
 * poked — everything is asserted through what the host would observe.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import studio from "../src/index.ts";
import { PROFILES, behaviorFor } from "../src/profiles.ts";

const CLEAN_CSS = `:root{--bg:#ffffff;--fg:#111111;--muted:#555555;--accent:#0b5fff;--on-accent:#ffffff}
body{background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif;margin:0}
h1{font-size:32px;line-height:1.2}
h2{font-size:24px;line-height:1.3}
p{font-size:16px;line-height:1.5}
small{font-size:13px}
.text-xs{font-size:13px}.text-sm{font-size:14px}.text-base{font-size:16px}.text-lg{font-size:18px}.text-xl{font-size:20px}
button{background:var(--accent);color:var(--on-accent);border:none;padding:8px 16px;font-size:16px}
button:hover{filter:brightness(0.95)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button:disabled{opacity:0.6;cursor:not-allowed}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const SLOPPY_CSS = `.card{color:#f5f5f5;background:#101014;backdrop-filter:blur(12px);border-radius:12px}
button{background:#7c3aed;color:#ffffff}
`;

const DESIGN_MD = `---
colors:
  background: "#ffffff"
typography:
  body: system-ui
---

# Design system

## Colors

- Background: #ffffff
- Foreground: #111111
- Muted: #555555
- Accent: #0b5fff
- On Accent: #ffffff

## Typography

- H1: 32px
- H2: 24px
- Body: 16px
- Small: 13px

## Motion

- Hover: 150ms ease
- Reduced motion: all transitions disabled
`;

function makeProject({ css = CLEAN_CSS } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-project-"));
  fs.writeFileSync(path.join(dir, "styles.css"), css);
  fs.writeFileSync(path.join(dir, "DESIGN.md"), DESIGN_MD);
  fs.writeFileSync(path.join(dir, "index.html"), "<html><body><main><h1>Fixture</h1></main></body></html>");
  return dir;
}

function harness(cwd, branch = []) {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-agent-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const commands = new Map();
  const tools = new Map();
  const events = new Map();
  const entries = branch;
  const messages = [];
  const notifications = [];
  const statuses = [];
  let editorText = "";

  const pi = {
    on: (event, handler) => events.set(event, handler),
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: (name, definition) => commands.set(name, definition),
    appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
    sendUserMessage: (text, options) => messages.push({ text, options }),
    setLabel: () => {},
  };

  studio(pi);

  const ctx = {
    cwd,
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
      setStatus: (key, value) => statuses.push({ key, value }),
      setEditorText: (text) => (editorText = text),
    },
    sessionManager: { getBranch: () => entries },
  };

  return {
    ctx,
    commands,
    tools,
    events,
    entries,
    messages,
    notifications,
    statuses,
    readEditor: () => editorText,
    config: () => JSON.parse(fs.readFileSync(path.join(agentDir, "pi-ui-studio.json"), "utf8")),
    cleanup: () => {
      fs.rmSync(agentDir, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    },
  };
}

const start = async (studioHarness) => studioHarness.events.get("session_start")({}, studioHarness.ctx);
const run = async (studioHarness, args) => studioHarness.commands.get("studio").handler(args, studioHarness.ctx);
const beforeStart = async (studioHarness) =>
  studioHarness.events.get("before_agent_start")({ systemPrompt: "BASE PROMPT" }, studioHarness.ctx);
const onStop = (studioHarness) => studioHarness.events.get("session_stop")({}, studioHarness.ctx);

test("registers one command surface and both engine tools", async (t) => {
  const h = harness(makeProject());
  t.after(h.cleanup);

  assert.deepEqual([...h.commands.keys()].sort(), ["designer", "studio", "ux"]);
  assert.deepEqual([...h.tools.keys()].sort(), ["studio_check", "ux_audit"]);

  for (const tool of h.tools.values()) {
    assert.ok(tool.description.length > 40, `${tool.name} needs a real description`);
    assert.equal(typeof tool.execute, "function");
  }
});

test("mode switching persists a profile and rejects unknown ones", async (t) => {
  const h = harness(makeProject());
  t.after(h.cleanup);
  await start(h);

  await run(h, "mode ux-first");
  assert.equal(h.config().profile, "ux-first");

  await run(h, "mode nonsense");
  assert.equal(h.config().profile, "ux-first");
  assert.match(h.notifications.at(-1).message, /Unknown profile/);
});

test("a phase command records the phase, previews it, and starts the turn", async (t) => {
  const h = harness(makeProject());
  t.after(h.cleanup);
  await start(h);

  await run(h, "audit");

  assert.equal(h.entries.at(-1).data.phase, "audit");
  assert.match(h.notifications.at(-1).message, /UI Studio · Balanced · Audit/);
  assert.match(h.notifications.at(-1).message, /Gate: Blocking/);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].options.attribution, "agent");
  assert.match(h.messages[0].text, /AUDIT/);
  assert.match(h.messages[0].text, /skill:\/\/studio-orchestrator/);
});

test("each phase injects the profile's UX level into the system prompt", async (t) => {
  const h = harness(makeProject());
  t.after(h.cleanup);
  await start(h);

  await run(h, "explore");
  const explorePrompt = await beforeStart(h);
  assert.match(String(explorePrompt.systemPrompt.at(-1)), /Pi UX: (off|lite) — advisory/);

  await run(h, "build");
  assert.match(String((await beforeStart(h)).systemPrompt.at(-1)), /Pi UX: lite — advisory/);

  await run(h, "mode ux-first");
  await run(h, "build");
  const uxFirst = await beforeStart(h);
  assert.match(String(uxFirst.systemPrompt.at(-1)), /Pi UX: strict — blocking/);
  assert.deepEqual(uxFirst.systemPrompt[0], "BASE PROMPT");
});

test("studio off suspends injection and status, studio on restores it", async (t) => {
  const h = harness(makeProject());
  t.after(h.cleanup);
  await start(h);
  await run(h, "build");

  await run(h, "off");
  assert.equal(await beforeStart(h), undefined);
  assert.equal(h.config().enabled, false);
  assert.ok(h.statuses.some((entry) => entry.key === "studio" && entry.value === ""));

  await run(h, "");
  assert.equal(h.config().enabled, true);
  assert.match(h.notifications.at(-1).message, /UI Studio is on/);
});

test("studio_check fails on slop and passes on a compliant project", async (t) => {
  const sloppy = harness(makeProject({ css: SLOPPY_CSS }));
  t.after(sloppy.cleanup);
  await start(sloppy);
  await run(sloppy, "build");

  const failed = await sloppy.tools.get("studio_check").execute("call-1", { path: path.join(sloppy.ctx.cwd, "styles.css") }, undefined, undefined, sloppy.ctx);
  assert.equal(failed.details.passed, false);
  assert.match(failed.content[0].text, /FAIL/);
  assert.match(failed.content[0].text, /off-system colour|slop tell|focus-visible/);

  const clean = harness(makeProject());
  t.after(clean.cleanup);
  await start(clean);
  await run(clean, "build");
  const passed = await clean.tools.get("studio_check").execute("call-2", { path: path.join(clean.ctx.cwd, "styles.css") }, undefined, undefined, clean.ctx);
  assert.equal(passed.details.passed, true, passed.content[0].text);
  assert.match(passed.content[0].text, /DESIGN\.md/);
});

test("the audit gate blocks until studio_check passes, and is bounded", async (t) => {
  const h = harness(makeProject({ css: SLOPPY_CSS }));
  t.after(h.cleanup);
  await start(h);
  await run(h, "audit");

  const blocked = onStop(h);
  assert.equal(blocked.continue, true);
  assert.match(blocked.additionalContext, /AUDIT GATE/);
  assert.match(blocked.additionalContext, /studio_check/);

  let continuations = 1;
  while (continuations < 6) {
    const next = onStop(h);
    if (!next) break;
    continuations += 1;
  }
  assert.equal(continuations, 3, "gate must stop asking after three continuations");
  assert.equal(onStop(h), undefined, "gate stays open once the continuation budget is spent");

  fs.writeFileSync(path.join(h.ctx.cwd, "styles.css"), CLEAN_CSS);
  const passed = await h.tools.get("studio_check").execute("call-3", { path: path.join(h.ctx.cwd, "styles.css") }, undefined, undefined, h.ctx);
  assert.equal(passed.details.passed, true, passed.content[0].text);
  assert.equal(onStop(h), undefined);
});

test("audit requires a DESIGN.md contract only in the audit phase", async (t) => {
  const dir = makeProject();
  fs.rmSync(path.join(dir, "DESIGN.md"));
  const h = harness(dir);
  t.after(h.cleanup);
  await start(h);

  await run(h, "build");
  const build = await h.tools.get("studio_check").execute("c1", { path: path.join(dir, "styles.css") }, undefined, undefined, h.ctx);
  assert.equal(build.details.passed, true, build.content[0].text);

  await run(h, "audit");
  const audit = await h.tools.get("studio_check").execute("c2", { path: path.join(dir, "styles.css") }, undefined, undefined, h.ctx);
  assert.equal(audit.details.passed, false);
  assert.match(audit.details.failures.join(" "), /DESIGN\.md is missing/);
});

test("status and doctor report the live configuration", async (t) => {
  const h = harness(makeProject());
  t.after(h.cleanup);
  await start(h);
  await run(h, "mode design-first");
  await run(h, "review");
  await run(h, "status");

  const status = h.readEditor();
  assert.match(status, /PI UI STUDIO/);
  assert.match(status, /Mode\s+Design-First/);
  assert.match(status, /Phase\s+Review/);
  assert.match(status, /Visual Reviews\s+3/);
  assert.match(status, /ux_audit\s+Available/);

  await run(h, "doctor");
  const doctor = h.readEditor();
  assert.match(doctor, /Vendor {2}OK/);
  assert.match(doctor, /omp-designer@\d+\.\d+\.\d+/);
  assert.match(doctor, /UX {6}OK/);
});

test("reports fall back to notifications when the host has no editor", async (t) => {
  const h = harness(makeProject());
  t.after(h.cleanup);
  delete h.ctx.ui.setEditorText;
  await start(h);

  await run(h, "status");
  assert.match(h.notifications.at(-1).message, /PI UI STUDIO/);
  assert.match(h.notifications.at(-1).message, /DESIGN\.md/);
  assert.equal(h.readEditor(), "");
});

test("upstream command names stay available and route to Studio state", async (t) => {
  const h = harness(makeProject());
  t.after(h.cleanup);
  await start(h);

  await h.commands.get("ux").handler("strict", h.ctx);
  assert.equal(h.config().uxOverride, "strict");

  await run(h, "build");
  const prompt = await beforeStart(h);
  assert.match(String(prompt.systemPrompt.at(-1)), /Pi UX: strict/);

  await h.commands.get("designer").handler("", h.ctx);
  assert.match(h.notifications.at(-1).message, /Designer engine · Balanced/);

  await h.commands.get("ux").handler("nonsense", h.ctx);
  assert.equal(h.config().uxOverride, "strict");
});

test("session state survives a restart through branch replay", async (t) => {
  const h = harness(makeProject());
  t.after(h.cleanup);
  await start(h);
  await run(h, "review");

  const replayHarness = harness(h.ctx.cwd, h.entries);
  t.after(replayHarness.cleanup);
  await start(replayHarness);

  await run(replayHarness, "status");
  assert.match(replayHarness.readEditor(), /Phase\s+Review/);
});

test("profiles tune intensity without moving authority", () => {
  for (const profile of Object.values(PROFILES)) {
    assert.equal(behaviorFor(profile, "audit").ux, "strict");
    assert.equal(behaviorFor(profile, "audit").blocking, true);
    assert.equal(behaviorFor(profile, "explore").blocking, false);
    assert.ok(behaviorFor(profile, "review").designer === "active");
  }
  assert.equal(PROFILES["design-first"].designer.visualReviews, 3);
  assert.equal(PROFILES["ux-first"].ux.duringBuild, "strict");
  assert.equal(PROFILES.balanced.ux.duringBuild, "lite");
});
