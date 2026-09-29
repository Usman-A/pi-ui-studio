/**
 * Designer-engine adapter tests.
 *
 * The upstream omp-designer extension is loaded for real — these pin the three
 * shims that make it work inside a vendored package (paths, runtime files, and
 * the policy proxy) and prove Studio, not upstream, decides enforcement.
 *
 * One agent directory is shared by the file because the upstream module binds
 * its paths at first import, exactly as it does in a host process.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import { activateDesignerEngine, ensureDesignerRuntime } from "../src/adapters/designer-engine.ts";

const AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "designer-agent-"));
const previousHome = process.env.HOME;

function projectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "designer-project-"));
}

function fakeHost() {
  const handlers = new Map();
  const commands = new Map();
  const host = {
    on: (event, handler) => handlers.set(event, handler),
    registerCommand: (name, definition) => commands.set(name, definition),
    registerTool: () => {},
    appendEntry: () => {},
    sendUserMessage: () => {},
    setLabel: () => {},
  };
  return { host, handlers, commands };
}

function fakeCtx(cwd) {
  const notifications = [];
  const editorText = [];
  return {
    ctx: {
      cwd,
      ui: {
        notify: (message) => notifications.push(message),
        setStatus: () => {},
        setEditorText: (text) => editorText.push(text),
      },
      sessionManager: { getBranch: () => [] },
    },
    notifications,
    editorText,
  };
}

after(() => {
  process.env.HOME = previousHome;
  fs.rmSync(AGENT_DIR, { recursive: true, force: true });
});

test("materialises the managed-skills and validator paths the upstream engine expects", () => {
  const report = ensureDesignerRuntime(AGENT_DIR);
  assert.deepEqual(report.method, "copy", "runtime files must be copied, never symlinked, for Windows parity");
  assert.ok(report.skills.length >= 12, `expected the full designer corpus, got ${report.skills.length}`);
  for (const name of ["designer-master", "design-md", "taste-skill", "visual-critique"]) {
    const target = path.join(AGENT_DIR, "managed-skills", name, "SKILL.md");
    assert.ok(fs.existsSync(target), `${name} missing`);
    assert.equal(fs.lstatSync(target).isSymbolicLink(), false, `${name} must be a real file`);
  }
  assert.ok(fs.existsSync(path.join(AGENT_DIR, "managed-skills", "ui-ux-pro-max-skill", "SKILL.md")));
  for (const script of ["fix-ai-slop.mjs", "analyze-layout.mjs"]) {
    const target = path.join(AGENT_DIR, "extensions", "designer", script);
    assert.ok(fs.existsSync(target), `${script} missing`);
    assert.equal(fs.lstatSync(target).isSymbolicLink(), false);
  }
  assert.deepEqual(ensureDesignerRuntime(AGENT_DIR).skills, report.skills, "second run must be idempotent");
});

test("studio mode loads the engine, keeps its commands, and withholds its prompt and gate", async (t) => {
  const project = projectDir();
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));

  const { host, handlers, commands } = fakeHost();
  const handle = await activateDesignerEngine(host, { agentDir: AGENT_DIR, mode: "studio" });
  assert.ok(handle, "engine must load");
  assert.deepEqual([...commands.keys()].sort(), ["designer", "designer-doctor", "designer-reset"]);

  const { ctx } = fakeCtx(project);
  fs.writeFileSync(path.join(AGENT_DIR, "designer-state.json"), JSON.stringify({ "*": true }));

  const prompt = await handlers.get("before_agent_start")({ systemPrompt: ["BASE"] }, ctx);
  assert.equal(prompt, undefined, "Studio composes its own prompt block; upstream injection stays off in studio mode");

  await handlers.get("agent_start")({}, ctx);
  const blocked = await handlers.get("tool_call")({ toolName: "write", input: { path: "x.ts" } }, ctx);
  assert.equal(blocked, undefined, "upstream gate may not block tools in studio mode");
});

test("upstream mode restores the engine's own prompt injection and gate", async (t) => {
  const project = projectDir();
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));

  const { host, handlers } = fakeHost();
  const handle = await activateDesignerEngine(host, { agentDir: AGENT_DIR, mode: "upstream" });
  const { ctx } = fakeCtx(project);
  fs.writeFileSync(path.join(AGENT_DIR, "designer-state.json"), JSON.stringify({ "*": true }));

  const prompt = await handlers.get("before_agent_start")({ systemPrompt: ["BASE"] }, ctx);
  assert.ok(Array.isArray(prompt?.systemPrompt), "upstream prompt injection must be honoured in upstream mode");
  assert.match(prompt.systemPrompt.join("\n"), /\[DESIGNER MODE: ACTIVE\]/);

  await handlers.get("agent_start")({}, ctx);
  const blocked = await handlers.get("tool_call")({ toolName: "write", input: { path: "x.ts" } }, ctx);
  assert.equal(blocked?.block, true, "upstream gate must block tools before the skill corpus is read");
  assert.match(blocked.reason, /designer-master/);

  handle.setMode("studio");
});

test("switching to studio mode at runtime re-scopes enforcement without a reload", async (t) => {
  const project = projectDir();
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));

  const { host, handlers } = fakeHost();
  const handle = await activateDesignerEngine(host, { agentDir: AGENT_DIR, mode: "upstream" });
  const { ctx } = fakeCtx(project);
  fs.writeFileSync(path.join(AGENT_DIR, "designer-state.json"), JSON.stringify({ "*": true }));
  await handlers.get("agent_start")({}, ctx);

  assert.equal((await handlers.get("tool_call")({ toolName: "write", input: {} }, ctx))?.block, true);

  handle.setMode("studio");
  assert.equal(await handlers.get("tool_call")({ toolName: "write", input: {} }, ctx), undefined);
  assert.equal(await handlers.get("before_agent_start")({ systemPrompt: ["BASE"] }, ctx), undefined);

  handle.setMode("upstream");
  assert.equal((await handlers.get("tool_call")({ toolName: "write", input: {} }, ctx))?.block, true);
});

test("upstream command handlers reach the host editor, which upstream addresses as ctx.editor", async (t) => {
  const project = projectDir();
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));

  const { host, commands } = fakeHost();
  await activateDesignerEngine(host, { agentDir: AGENT_DIR, mode: "studio" });
  const { ctx, editorText } = fakeCtx(project);

  await commands.get("designer-doctor").handler("", ctx);
  assert.ok(editorText.length > 0, "doctor report must reach the host composer");
});

test("engine state prunes projects that no longer exist", async (t) => {
  const project = projectDir();
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));

  const stateFile = path.join(AGENT_DIR, "designer-state.json");
  fs.writeFileSync(stateFile, JSON.stringify({ [project]: true, "/definitely/gone/project": true, "*": true }));

  await activateDesignerEngine(fakeHost().host, { agentDir: AGENT_DIR, mode: "studio", cwd: project });

  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(state[project], true);
  assert.equal(state["/definitely/gone/project"], undefined, "vanished projects must not accumulate");
  assert.equal(state["*"], true);
});
