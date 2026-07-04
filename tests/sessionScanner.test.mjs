import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { tmpdir } from "node:os";
import { join } from "node:path";

function loadSessionScannerModule() {
	const source = readFileSync("src/main/sessions/SessionScanner.ts", "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			esModuleInterop: true,
		},
	});
	const sandbox = {
		exports: {},
		require: (id) => {
			if (id === "electron") {
				return { app: { getPath: (name) => name === "home" ? "/home/user" : tmpdir() } };
			}
			if (id === "node:fs") {
				return {
					existsSync: () => false,
					readFileSync: () => "",
				};
			}
			if (id === "node:fs/promises") {
				return {
					readdir: async () => [],
					readFile: async () => "",
					stat: async () => ({ mtimeMs: Date.now() }),
					unlink: async () => {},
					writeFile: async () => {},
				};
			}
			if (id === "node:path") {
				return { basename: (p, ext) => {
					const b = p.split(/[\\/]/).pop() || p;
					return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
				}, dirname: (p) => p.split(/[\\/]/).slice(0, -1).join("/") || ".",
				extname: (p) => { const m = p.match(/\.[^.]+$/); return m ? m[0] : ""; },
				join: (...parts) => parts.join("/") };
			}
			if (id === "../../shared/types") return {};
			throw new Error(`Unexpected require: ${id}`);
		},
		console,
		JSON,
		Date,
		Promise,
		Boolean,
		String,
		Number,
		Array,
		Object,
		Error,
		RegExp,
		Math,
		parseInt,
	};
	vm.runInNewContext(outputText, sandbox, {
		filename: "SessionScanner.ts",
	});
	return sandbox.exports;
}

// ── extractText ─────────────────────────────────────────

test("extractText returns string content directly", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const scanner = new SessionScanner();
	const extract = SessionScanner.prototype["extractText"];
	assert.equal(extract("hello world"), "hello world");
});

test("extractText joins array of text items", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const extract = SessionScanner.prototype["extractText"];
	const result = extract([
		{ text: "first" },
		{ text: "second" },
		{ thinking: "deep thought" },
	]);
	assert.equal(result, "first second deep thought");
});

test("extractText handles mixed string and object arrays", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const extract = SessionScanner.prototype["extractText"];
	const result = extract(["plain text", { text: "object text" }]);
	assert.equal(result, "plain text object text");
});

test("extractText returns empty string for non-string non-array", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const extract = SessionScanner.prototype["extractText"];
	assert.equal(extract(42), "");
	assert.equal(extract(null), "");
	assert.equal(extract(undefined), "");
});

// ── cleanTitle ──────────────────────────────────────────

test("cleanTitle trims and normalizes whitespace", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const clean = SessionScanner.prototype["cleanTitle"];
	assert.equal(clean("  hello   world  "), "hello world");
});

test("cleanTitle truncates at 32 chars with ellipsis", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const clean = SessionScanner.prototype["cleanTitle"];
	const long = "a".repeat(50);
	const result = clean(long);
	assert.equal(result.length, 33); // 32 + ellipsis char
	assert.ok(result.endsWith("…"));
});

test("cleanTitle returns undefined for untitled", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const clean = SessionScanner.prototype["cleanTitle"];
	assert.equal(clean("Untitled"), undefined);
	assert.equal(clean("untitled"), undefined);
	assert.equal(clean("UNTITLED"), undefined);
});

test("cleanTitle returns undefined for empty or undefined input", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const clean = SessionScanner.prototype["cleanTitle"];
	assert.equal(clean(undefined), undefined);
	assert.equal(clean(""), undefined);
	assert.equal(clean("   "), undefined);
});

// ── normalize ───────────────────────────────────────────

test("normalize replaces backslashes and removes trailing slash", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const normalize = SessionScanner.prototype["normalize"];
	assert.equal(normalize("C:\\Users\\Dev\\project\\"), "c:/users/dev/project");
});

test("normalize lowercases the path", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const normalize = SessionScanner.prototype["normalize"];
	assert.equal(normalize("/Home/User/Project"), "/home/user/project");
});

// ── safePathToken ───────────────────────────────────────

test("safePathToken encodes Windows drive path", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const safe = SessionScanner.prototype["safePathToken"];
	assert.equal(safe("C:\\Users\\dev\\project"), "--c--users-dev-project--");
});

test("safePathToken encodes Unix path", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const safe = SessionScanner.prototype["safePathToken"];
	assert.equal(safe("/home/user/project"), "--home-user-project--");
});

// ── decodeSessionDir ────────────────────────────────────

test("decodeSessionDir decodes Windows-style encoded dir", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const decode = SessionScanner.prototype["decodeSessionDir"];
	const result = decode("--C--Users-dev-project--");
	// The method converts dashes to slashes then replaces all / with \
	assert.equal(result, "C:\\Users\\dev\\project");
});

test("decodeSessionDir decodes plain encoded dir", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const decode = SessionScanner.prototype["decodeSessionDir"];
	const result = decode("--home-user-project--");
	assert.equal(result, "home\\user\\project");
});

// ── escapeHtml ──────────────────────────────────────────

test("escapeHtml escapes special HTML characters", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const escape = SessionScanner.prototype["escapeHtml"];
	assert.equal(
		escape('<script>alert("xss")</script> & more'),
		'&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; more',
	);
});

test("escapeHtml returns plain text unchanged", () => {
	const { SessionScanner } = loadSessionScannerModule();
	const escape = SessionScanner.prototype["escapeHtml"];
	assert.equal(escape("hello world 123"), "hello world 123");
});
