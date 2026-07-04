import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadModule() {
	const source = readFileSync("src/renderer/src/agentListDisplay.ts", "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	});
	const sandbox = { exports: {} };
	vm.runInNewContext(outputText, sandbox, {
		filename: "agentListDisplay.ts",
	});
	return sandbox.exports;
}

// ── normalizeSessionPathForCompare ──────────────────────

test("normalizes backslashes and trailing slashes to lowercase", () => {
	const { normalizeSessionPathForCompare } = loadModule();
	assert.equal(
		normalizeSessionPathForCompare("C:\\Users\\Dev\\project\\"),
		"c:/users/dev/project",
	);
});

test("returns undefined for undefined input", () => {
	const { normalizeSessionPathForCompare } = loadModule();
	assert.equal(normalizeSessionPathForCompare(undefined), undefined);
});

// ── isSameSessionPath ───────────────────────────────────

test("matches paths with different separators and casing", () => {
	const { isSameSessionPath } = loadModule();
	assert.equal(
		isSameSessionPath(
			"C:\\Users\\Dev\\.pi\\sessions\\test.jsonl",
			"c:/users/dev/.pi/sessions/test.jsonl",
		),
		true,
	);
});

test("returns false when one path is undefined", () => {
	const { isSameSessionPath } = loadModule();
	assert.equal(isSameSessionPath(undefined, "/some/path"), false);
});

test("returns false for different paths", () => {
	const { isSameSessionPath } = loadModule();
	assert.equal(
		isSameSessionPath("/home/user/a.jsonl", "/home/user/b.jsonl"),
		false,
	);
});

// ── getProjectAgentSessionDisplay ───────────────────────

test("merges agents and sessions, agents appear above sessions with same timestamp", () => {
	const { getProjectAgentSessionDisplay } = loadModule();

	const now = Date.now();
	const agents = [
		{ id: "agent-1", sessionPath: "/sessions/a.jsonl", createdAt: now, status: "running" },
	];
	const sessions = [
		{ filePath: "/sessions/a.jsonl", updatedAt: now - 1000, name: "Session A", source: "pi" },
		{ filePath: "/sessions/b.jsonl", updatedAt: now - 2000, name: "Session B", source: "codex" },
	];

	const result = getProjectAgentSessionDisplay({ agents, sessions });

	// Agent for a.jsonl should take precedence over session a.jsonl
	assert.equal(result.children.length, 2);
	assert.equal(result.children[0].type, "agent");
	assert.equal(result.children[0].agent.id, "agent-1");
	// Session b.jsonl should appear since no agent owns it
	assert.equal(result.children[1].type, "session");
	assert.equal(result.children[1].session.name, "Session B");
});

test("respects visibleChildCount limit", () => {
	const { getProjectAgentSessionDisplay } = loadModule();

	const sessions = Array.from({ length: 10 }, (_, i) => ({
		filePath: `/sessions/s${i}.jsonl`,
		updatedAt: Date.now() - i * 1000,
		name: `Session ${i}`,
	}));

	const result = getProjectAgentSessionDisplay({
		agents: [],
		sessions,
		visibleChildCount: 3,
	});

	assert.equal(result.children.length, 10);
	assert.equal(result.visibleChildren.length, 3);
	assert.equal(result.hiddenChildCount, 7);
});

test("defaults to 5 visible children", () => {
	const { getProjectAgentSessionDisplay } = loadModule();

	const sessions = Array.from({ length: 8 }, (_, i) => ({
		filePath: `/sessions/s${i}.jsonl`,
		updatedAt: Date.now() - i * 1000,
		name: `Session ${i}`,
	}));

	const result = getProjectAgentSessionDisplay({ agents: [], sessions });

	assert.equal(result.visibleChildren.length, 5);
	assert.equal(result.hiddenChildCount, 3);
});

test("deduplicates agents with same sessionPath keeping the newer one", () => {
	const { getProjectAgentSessionDisplay } = loadModule();

	const now = Date.now();
	const agents = [
		{ id: "agent-old", sessionPath: "/sessions/a.jsonl", createdAt: now - 5000, status: "idle" },
		{ id: "agent-new", sessionPath: "/sessions/a.jsonl", createdAt: now, status: "running" },
	];
	const sessions = [
		{ filePath: "/sessions/a.jsonl", updatedAt: now - 1000, name: "Session A" },
	];

	const result = getProjectAgentSessionDisplay({ agents, sessions });

	assert.equal(result.children.length, 1);
	assert.equal(result.children[0].type, "agent");
	assert.equal(result.children[0].agent.id, "agent-new");
});

test("agents without sessionPath appear as unkeyed agents", () => {
	const { getProjectAgentSessionDisplay } = loadModule();

	const now = Date.now();
	const agents = [
		{ id: "agent-1", createdAt: now, status: "running" },
	];

	const result = getProjectAgentSessionDisplay({ agents, sessions: [] });

	assert.equal(result.children.length, 1);
	assert.equal(result.children[0].type, "agent");
	assert.equal(result.children[0].key, "agent:agent-1");
});

test("carries source from session to agent display item", () => {
	const { getProjectAgentSessionDisplay } = loadModule();

	const now = Date.now();
	const agents = [
		{ id: "agent-1", sessionPath: "/sessions/imported.jsonl", createdAt: now, status: "running" },
	];
	const sessions = [
		{ filePath: "/sessions/imported.jsonl", updatedAt: now - 1000, name: "Imported", source: "claude" },
	];

	const result = getProjectAgentSessionDisplay({ agents, sessions });

	assert.equal(result.children[0].source, "claude");
});
