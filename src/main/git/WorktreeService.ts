import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import type { WorktreeEntry } from "../../shared/types";

const execFileAsync = promisify(execFile);

/**
 * 管理 git worktree 的创建、查询、删除。
 *
 * 工作树目录统一存放在 {userData}/worktrees/{projectId}/{slug}，
 * 不污染项目目录本身。
 */
export class WorktreeService {
	/**
	 * 获取指定项目仓库的所有 worktree（排除主工作区）。
	 * 使用 git worktree list --porcelain 解析。
	 */
	async list(projectPath: string): Promise<WorktreeEntry[]> {
		try {
			const { stdout } = await execFileAsync(
				"git",
				["worktree", "list", "--porcelain"],
				{ cwd: projectPath },
			);
			return this.parseWorktreeList(stdout, projectPath);
		} catch {
			// 非 git 目录或 git 未安装
			return [];
		}
	}

	/**
	 * 基于当前 HEAD 创建新的 worktree。
	 * 使用 OpenCode 的方式：--no-checkout -b {branch} 创建分支，再 git reset --hard 填充。
	 */
	async create(
		projectPath: string,
		projectId: string,
		branchName: string,
	): Promise<{ path: string; branch: string }> {
		const baseSlug = this.slugify(branchName);
		await mkdir(this.resolveWorktreeRootDir(projectId), { recursive: true });

		const { worktreeDir, branch } = await this.allocateWorktreeTarget(projectPath, projectId, baseSlug);

		// 创建 worktree（仅创建目录结构，不 checkout），再 reset --hard 填充内容。
		await execFileAsync(
			"git",
			["worktree", "add", "--no-checkout", "-b", branch, worktreeDir],
			{ cwd: projectPath },
		);

		try {
			await execFileAsync("git", ["reset", "--hard"], { cwd: worktreeDir });
		} catch (error) {
			// reset 失败时清理刚创建的 worktree，避免残留半初始化目录。
			await this.remove(worktreeDir, projectPath).catch(() => false);
			throw error;
		}

		return { path: worktreeDir, branch };
	}

	/**
	 * 删除指定 worktree。
	 * 先 git worktree remove --force，再清理目录，最后删除对应的分支。
	 */
	async remove(worktreePath: string, projectPath: string): Promise<boolean> {
		const entries = await this.list(projectPath);
		const normalizedTarget = await this.canonical(worktreePath);
		const entry = entries.find(asyncEntry => this.samePath(asyncEntry.path, normalizedTarget));
		if (!entry) return false;
		const branch = entry.branch;

		try {
			await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], { cwd: projectPath });
		} catch {
			// git 的记录可能已损坏；后续仍尝试清理目录，但不吞掉路径保护。
		}

		try {
			await rm(worktreePath, { recursive: true, force: true });
		} catch {
			return false;
		}

		// 只删除 PiDeck 创建的分支，避免误删用户外部 worktree 的业务分支。
		if (branch?.startsWith("pideck/")) {
			await execFileAsync("git", ["branch", "-D", branch], { cwd: projectPath }).catch(() => undefined);
		}

		return true;
	}

	/**
	 * 生成唯一可用的目录名和分支名。
	 * 将分支名 slug 化，避免非法字符。
	 */
	private async allocateWorktreeTarget(projectPath: string, projectId: string, baseSlug: string) {
		for (let attempt = 0; attempt < 26; attempt++) {
			const suffix = attempt === 0 ? "" : `-${String.fromCharCode(97 + attempt - 1)}`;
			const slug = `${baseSlug}${suffix}`;
			const worktreeDir = this.resolveWorktreeDir(projectId, slug);
			const branch = `pideck/${slug}`;
			if (existsSync(worktreeDir)) continue;
			const ref = await execFileAsync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: projectPath })
				.then(() => true)
				.catch(() => false);
			if (ref) continue;
			return { worktreeDir, branch };
		}
		throw new Error("无法生成唯一的 worktree 名称");
	}

	private slugify(input: string): string {
		return input
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+/, "")
			.replace(/-+$/, "")
			|| "workspace";
	}

	/** worktree 统一存放根目录：{userData}/worktrees/{projectId} */
	private resolveWorktreeRootDir(projectId: string): string {
		const userData = app.getPath("userData");
		return join(userData, "worktrees", projectId);
	}

	/** worktree 目录：{userData}/worktrees/{projectId}/{slug} */
	private resolveWorktreeDir(projectId: string, slug: string): string {
		return join(this.resolveWorktreeRootDir(projectId), slug);
	}

	/**
	 * 解析 git worktree list --porcelain 输出。
	 * 过滤掉主工作区（projectPath），只返回其他 worktree。
	 */
	private parseWorktreeList(stdout: string, projectPath: string): WorktreeEntry[] {
		const entries: WorktreeEntry[] = [];
		// 规范化路径用于比较（Windows 忽略大小写）
		const normalizedRoot = this.canonicalSync(projectPath);

		const lines = stdout.split(/\r?\n/);
		let current: Partial<WorktreeEntry> | null = null;

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) {
				// 空行 = 条目结束
				if (current) {
					const path = current.path ? resolve(current.path) : "";
					if (!this.samePath(path, normalizedRoot)) {
						entries.push({
							path,
							branch: current.branch?.replace(/^refs\/heads\//, "") ?? "detached",
						});
					}
					current = null;
				}
				continue;
			}

			if (trimmed.startsWith("worktree ")) {
				current = { path: trimmed.slice("worktree ".length).trim() };
				continue;
			}

			if (current && trimmed.startsWith("branch ")) {
				current.branch = trimmed.slice("branch ".length).trim();
			}
		}

		// 处理最后一条（文件可能不以空行结尾）
		if (current) {
			const path = current.path ? resolve(current.path) : "";
			if (!this.samePath(path, normalizedRoot)) {
				entries.push({
					path,
					branch: current.branch?.replace(/^refs\/heads\//, "") ?? "detached",
				});
			}
		}

		return entries;
	}

	private canonicalSync(input: string) {
		const normalized = resolve(input);
		return process.platform === "win32" ? normalized.toLowerCase() : normalized;
	}

	private async canonical(input: string) {
		const resolved = resolve(input);
		const real = await realpath(resolved).catch(() => resolved);
		return process.platform === "win32" ? real.toLowerCase() : real;
	}

	private samePath(a: string, b: string) {
		return this.canonicalSync(a) === this.canonicalSync(b);
	}
}