import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadConfigManagerModule() {
	const source = readFileSync("src/main/config/ConfigManager.ts", "utf8");
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
			if (id === "node:fs/promises") {
				return {
					readFile: async (path) => readFileSync(path, "utf8"),
					writeFile: async () => {},
					mkdir: async () => {},
				};
			}
			if (id === "node:path") return { normalize: (p) => p, join, homedir: () => "/home/user" };
			if (id === "node:os") return { homedir: () => "/home/user" };
			if (id === "electron") return { net: { fetch: async () => {} } };
			if (id === "../../shared/types") return {};
			throw new Error(`Unexpected require: ${id}`);
		},
		URL,
		setTimeout,
		clearTimeout,
		Date,
		JSON,
		console,
		Number,
		Array,
		Object,
		String,
		Boolean,
		Error,
		Promise,
		encodeURIComponent,
	};
	vm.runInNewContext(outputText, sandbox, {
		filename: "ConfigManager.ts",
	});
	return sandbox.exports;
}

// ── normalizeApiType (via normalizeModelsForPi which uses it) ──

test("normalizeApiType maps anthropic to anthropic-messages", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const manager = new ConfigManager("/tmp/test-config");

	// We test indirectly via saveModelsConfig validation then normalizeModelsForPi
	// Use the private method through the class prototype
	const normalize = ConfigManager.prototype["normalizeApiType"];
	assert.equal(normalize("anthropic"), "anthropic-messages");
	assert.equal(normalize("anthropic-messages"), "anthropic-messages");
});

test("normalizeApiType maps openai-chat-completions alias to openai-completions", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const normalize = ConfigManager.prototype["normalizeApiType"];
	assert.equal(normalize("openai-chat-completions"), "openai-completions");
});

test("normalizeApiType preserves known api types", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const normalize = ConfigManager.prototype["normalizeApiType"];
	assert.equal(normalize("openai-completions"), "openai-completions");
	assert.equal(normalize("openai-responses"), "openai-responses");
	assert.equal(normalize("openai-codex-responses"), "openai-codex-responses");
	assert.equal(normalize("google-generative-ai"), "google-generative-ai");
	assert.equal(normalize("mistral-conversations"), "mistral-conversations");
});

test("normalizeApiType defaults unknown types to openai-completions", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const normalize = ConfigManager.prototype["normalizeApiType"];
	assert.equal(normalize(undefined), "openai-completions");
	assert.equal(normalize("something-else"), "openai-completions");
});

// ── ensureVersionPath ───────────────────────────────────

test("ensureVersionPath appends /v1 when no version path exists", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const ensure = ConfigManager.prototype["ensureVersionPath"];
	assert.equal(ensure("https://api.example.com"), "https://api.example.com/v1");
	assert.equal(ensure("http://localhost:11434"), "http://localhost:11434/v1");
});

test("ensureVersionPath does not double-add /v1", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const ensure = ConfigManager.prototype["ensureVersionPath"];
	assert.equal(ensure("https://api.example.com/v1"), "https://api.example.com/v1");
});

test("ensureVersionPath skips urls ending with /api", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const ensure = ConfigManager.prototype["ensureVersionPath"];
	assert.equal(ensure("https://service.com/api"), "https://service.com/api");
});

test("ensureVersionPath strips trailing slashes before checking", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const ensure = ConfigManager.prototype["ensureVersionPath"];
	assert.equal(ensure("https://api.example.com/v1/"), "https://api.example.com/v1");
});

// ── googleModelPath ─────────────────────────────────────

test("googleModelPath adds models/ prefix when missing", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const gmPath = ConfigManager.prototype["googleModelPath"];
	assert.equal(gmPath("gemini-2.0-flash"), "models/gemini-2.0-flash");
});

test("googleModelPath preserves existing models/ prefix", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const gmPath = ConfigManager.prototype["googleModelPath"];
	assert.equal(gmPath("models/gemini-2.0-flash"), "models/gemini-2.0-flash");
});

// ── redactSecret ────────────────────────────────────────

test("redactSecret replaces apiKey occurrences with ***", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const redact = ConfigManager.prototype["redactSecret"];
	const result = redact("Error at https://api.com/key=sk-abc123/test", "sk-abc123");
	assert.equal(result, "Error at https://api.com/key=***/test");
});

test("redactSecret returns value unchanged when apiKey is empty", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const redact = ConfigManager.prototype["redactSecret"];
	assert.equal(redact("some error message", ""), "some error message");
});

// ── validateModels ──────────────────────────────────────

test("validateModels rejects data without providers field", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const validate = ConfigManager.prototype["validateModels"];
	const result = validate({});
	assert.equal(result.valid, false);
	assert.match(result.error, /providers/);
});

test("validateModels rejects provider without models array", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const validate = ConfigManager.prototype["validateModels"];
	const result = validate({ providers: { test: {} } });
	assert.equal(result.valid, false);
	assert.match(result.error, /models/);
});

test("validateModels rejects model without valid id", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const validate = ConfigManager.prototype["validateModels"];
	const result = validate({
		providers: { openai: { models: [{ name: "test" }] } },
	});
	assert.equal(result.valid, false);
	assert.match(result.error, /id/);
});

test("validateModels accepts valid structure", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const validate = ConfigManager.prototype["validateModels"];
	const result = validate({
		providers: {
			openai: {
				models: [{ id: "gpt-4o", name: "GPT 4o" }],
			},
		},
	});
	assert.equal(result.valid, true);
});

// ── parseModelsResponse ─────────────────────────────────

test("parseModelsResponse extracts models from OpenAI data array", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const manager = new ConfigManager("/tmp/test");
	const result = manager["parseModelsResponse"](
		{ data: [{ id: "gpt-4o" }, { id: "gpt-3.5-turbo" }] },
		"openai-completions",
	);
	assert.equal(result.length, 2);
	assert.equal(result[0].id, "gpt-4o");
	assert.equal(result[1].id, "gpt-3.5-turbo");
});

test("parseModelsResponse strips models/ prefix for Google API", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const manager = new ConfigManager("/tmp/test");
	const result = manager["parseModelsResponse"](
		{ models: [{ name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash" }] },
		"google-generative-ai",
	);
	assert.equal(result.length, 1);
	assert.equal(result[0].id, "gemini-2.0-flash");
	assert.equal(result[0].name, "Gemini 2.0 Flash");
});

test("parseModelsResponse skips items without valid id", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const manager = new ConfigManager("/tmp/test");
	const result = manager["parseModelsResponse"](
		{ data: [{ id: "" }, { id: "valid-model" }, { foo: "bar" }] },
		"openai-completions",
	);
	assert.equal(result.length, 1);
	assert.equal(result[0].id, "valid-model");
});

test("parseModelsResponse handles body.models array format", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const manager = new ConfigManager("/tmp/test");
	const result = manager["parseModelsResponse"](
		{ models: [{ id: "claude-3-5-sonnet" }] },
		"anthropic-messages",
	);
	assert.equal(result.length, 1);
	assert.equal(result[0].id, "claude-3-5-sonnet");
});

// ── normalizeRequestHeaders ─────────────────────────────

test("normalizeRequestHeaders filters out empty keys", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const normalize = ConfigManager.prototype["normalizeRequestHeaders"];
	const result = normalize({ "": "value", "X-Custom": "test", "  ": "ignored" });
	assert.deepEqual(result, { "X-Custom": "test" });
});

test("normalizeRequestHeaders returns empty object for undefined input", () => {
	const { ConfigManager } = loadConfigManagerModule();
	const normalize = ConfigManager.prototype["normalizeRequestHeaders"];
	const result = normalize(undefined);
	assert.equal(JSON.stringify(result), "{}");
});

// ── ConfigManager.readJsonFile and saveRawConfig ────────

test("saveRawConfig rejects invalid JSON", async () => {
	const root = join(tmpdir(), `cm-test-${process.pid}-${Date.now()}`);
	mkdirSync(root, { recursive: true });

	try {
		const { ConfigManager } = loadConfigManagerModule();
		const manager = new ConfigManager(root);
		const result = await manager.saveRawConfig("models.json", "not valid json{");
		assert.equal(result.valid, false);
		assert.match(result.error, /JSON/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("saveRawConfig rejects disallowed file names", async () => {
	const root = join(tmpdir(), `cm-test-${process.pid}-${Date.now()}`);
	mkdirSync(root, { recursive: true });

	try {
		const { ConfigManager } = loadConfigManagerModule();
		const manager = new ConfigManager(root);
		const result = await manager.saveRawConfig("evil.json", "{}");
		assert.equal(result.valid, false);
		assert.match(result.error, /不允许/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
