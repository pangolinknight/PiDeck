/**
 * 飞书配置管理
 *
 * 多 Bot CRUD + App Secret 加密存储。
 * 数据持久化到 ~/.pi-desktop/feishu.json
 */

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import type { FeishuBotConfig } from "../../shared/types";

// ===== 配置文件路径 =====

function getConfigDir(): string {
	const dir = join(app.getPath("userData"), "pi-desktop");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

function getFeishuConfigPath(): string {
	return join(getConfigDir(), "feishu.json");
}

function getFeishuBindingsPath(botId: string): string {
	return join(getConfigDir(), `feishu-bindings-${botId}.json`);
}

// ===== 多 Bot 配置 =====

export type FeishuMultiBotConfig = {
	version: 2;
	bots: FeishuBotConfig[];
	/** 删除 Bot 只移除配置，不删除绑定文件；重新添加同一 App ID 时复用旧 ID 防止重复建群。 */
	deletedBotIdsByAppId?: Record<string, string>;
};

function readConfig(): FeishuMultiBotConfig {
	const path = getFeishuConfigPath();
	if (!existsSync(path)) {
		return { version: 2, bots: [], deletedBotIdsByAppId: {} };
	}
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw);

		// 向后兼容 v1 格式（单 Bot）
		if (parsed.version === 1 && parsed.appId) {
			return {
				version: 2,
				bots: [
					{
						id: parsed.id || randomUUID(),
						name: parsed.name || "默认机器人",
						enabled: parsed.enabled !== false,
						appId: parsed.appId || "",
						appSecret: parsed.appSecret || "",
						defaultWorkspaceId: parsed.defaultWorkspaceId,
						requireMention: parsed.requireMention,
					},
				],
			};
		}

		return parsed as FeishuMultiBotConfig;
	} catch {
		return { version: 2, bots: [], deletedBotIdsByAppId: {} };
	}
}

function writeConfig(config: FeishuMultiBotConfig): void {
	const path = getFeishuConfigPath();
	writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}

// ===== 公开 API =====

/** 列出所有 Bot 配置 */
export function listBots(): FeishuBotConfig[] {
	return readConfig().bots;
}

/** 获取单个 Bot 配置 */
export function getBot(botId: string): FeishuBotConfig | undefined {
	return readConfig().bots.find((b) => b.id === botId);
}

/** 添加 Bot */
export function addBot(input: {
	name: string;
	appId: string;
	appSecret: string;
	defaultWorkspaceId?: string;
	defaultUserOpenId?: string;
	requireMention?: boolean;
}): FeishuBotConfig {
	const config = readConfig();
	const appId = input.appId.trim();
	const existingIndex = config.bots.findIndex((b) => b.appId === appId);
	const reusedId = config.deletedBotIdsByAppId?.[appId];
	const bot: FeishuBotConfig = {
		// 同一飞书应用重新添加时复用旧 botId，旧绑定文件才能继续按 sessionPath/chatId 复用。
		id: existingIndex >= 0 ? config.bots[existingIndex].id : (reusedId || randomUUID()),
		name: input.name,
		enabled: true,
		appId,
		appSecret: encryptSecret(input.appSecret),
		defaultWorkspaceId: input.defaultWorkspaceId,
		defaultUserOpenId: input.defaultUserOpenId,
		requireMention: input.requireMention ?? true,
	};
	if (existingIndex >= 0) {
		config.bots[existingIndex] = { ...config.bots[existingIndex], ...bot };
	} else {
		config.bots.push(bot);
	}
	if (config.deletedBotIdsByAppId) delete config.deletedBotIdsByAppId[appId];
	writeConfig(config);
	return bot;
}

/** 更新 Bot 配置 */
export function updateBot(botId: string, patch: Partial<FeishuBotConfig>): FeishuBotConfig | undefined {
	const config = readConfig();
	const index = config.bots.findIndex((b) => b.id === botId);
	if (index === -1) return undefined;

	// 如果 patch.appSecret 是明文（非已加密格式），加密后存储
	if (patch.appSecret && !isEncryptedOrBase64(patch.appSecret)) {
		patch.appSecret = encryptSecret(patch.appSecret);
	}

	config.bots[index] = { ...config.bots[index], ...patch };
	writeConfig(config);
	return config.bots[index];
}

/** 删除 Bot */
export function removeBot(botId: string): boolean {
	const config = readConfig();
	const removed = config.bots.find((b) => b.id === botId);
	const before = config.bots.length;
	config.bots = config.bots.filter((b) => b.id !== botId);
	if (config.bots.length === before) return false;
	if (removed?.appId) {
		// 只删除 Bot 配置，不删除群绑定文件；记录 appId → botId 供后续重加同一应用时复用。
		config.deletedBotIdsByAppId = config.deletedBotIdsByAppId ?? {};
		config.deletedBotIdsByAppId[removed.appId] = removed.id;
	}
	writeConfig(config);
	return true;
}

/** 解密 App Secret */
export function getDecryptedBotAppSecret(botId: string): string {
	const bot = getBot(botId);
	if (!bot) return "";
	return decryptSecret(bot.appSecret);
}

// ===== 会话-Bot 分配持久化 =====

/**
 * 为每个 Agent 分配一个指定的飞书 Bot。
 * 如果未分配，默认使用连接中的 Bot。
 */
const SESSION_BOT_MAP_PATH = join(getConfigDir(), "feishu-session-bot.json");

function readSessionBotMap(): Record<string, string> {
	try {
		if (!existsSync(SESSION_BOT_MAP_PATH)) return {};
		return JSON.parse(readFileSync(SESSION_BOT_MAP_PATH, "utf-8"));
	} catch {
		return {};
	}
}

function writeSessionBotMap(map: Record<string, string>): void {
	writeFileSync(SESSION_BOT_MAP_PATH, JSON.stringify(map, null, 2), "utf-8");
}

/** 获取某个 Agent 指定的 Bot ID，如果未指定返回 undefined */
export function getSessionBotId(agentId: string): string | undefined {
	const map = readSessionBotMap();
	return map[agentId];
}

/** 设置/清除某个 Agent 使用的 Bot ID。传 undefined 或空字符串清除分配。 */
export function setSessionBotId(agentId: string, botId: string | undefined): void {
	const map = readSessionBotMap();
	if (botId) {
		map[agentId] = botId;
	} else {
		delete map[agentId];
	}
	writeSessionBotMap(map);
}

// ===== 绑定持久化 =====

export type FeishuChatBindingPersist = {
	chatId: string;
	botId: string;
	userId: string;
	sessionId: string;
	sessionPath?: string;
	workspaceId: string;
	channelId?: string;
	modelId?: string;
	source: string;
	chatType: string;
	groupName?: string;
	createdAt: number;
};

export function loadBindings(botId: string): FeishuChatBindingPersist[] {
	const path = getFeishuBindingsPath(botId);
	if (!existsSync(path)) return [];
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as FeishuChatBindingPersist[];
	} catch {
		return [];
	}
}

export function saveBindings(botId: string, bindings: FeishuChatBindingPersist[]): void {
	const path = getFeishuBindingsPath(botId);
	writeFileSync(path, JSON.stringify(bindings, null, 2), "utf-8");
}

// ===== 加密/解密（使用 Electron safeStorage，降级为 base64） =====

/** safeStorage 前缀标记，用于区分新格式密文和旧 base64 密文 */
const SAFE_STORAGE_PREFIX = "v2:";

function encryptSecret(plainSecret: string): string {
	if (safeStorage.isEncryptionAvailable()) {
		const encrypted = safeStorage.encryptString(plainSecret);
		return SAFE_STORAGE_PREFIX + encrypted.toString("base64");
	}
	// 降级：系统密钥链不可用时仍使用 base64（如 CI 环境）
	return Buffer.from(plainSecret, "utf-8").toString("base64");
}

function decryptSecret(encryptedSecret: string): string {
	if (!encryptedSecret) return "";
	try {
		if (encryptedSecret.startsWith(SAFE_STORAGE_PREFIX)) {
			const ciphertext = Buffer.from(encryptedSecret.slice(SAFE_STORAGE_PREFIX.length), "base64");
			return safeStorage.decryptString(ciphertext);
		}
		// 向后兼容：旧格式 base64 密文
		return Buffer.from(encryptedSecret, "base64").toString("utf-8");
	} catch {
		return encryptedSecret;
	}
}

function isEncryptedOrBase64(str: string): boolean {
	if (str.startsWith(SAFE_STORAGE_PREFIX)) return true;
	if (!str || str.length % 4 !== 0) return false;
	return /^[A-Za-z0-9+/]*={0,2}$/.test(str);
}