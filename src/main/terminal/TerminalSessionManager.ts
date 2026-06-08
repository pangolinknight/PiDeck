import * as pty from "node-pty";
import { randomUUID } from "node:crypto";
import { ipcChannels } from "../../shared/ipc";
import type { TerminalShell, TerminalTab } from "../../shared/types";

type TerminalRuntime = {
	tab: TerminalTab;
	pty: pty.IPty;
};

type Emit = (channel: string, payload: unknown) => void;

export class TerminalSessionManager {
	private readonly runtimes = new Map<string, Map<string, TerminalRuntime>>();

	constructor(
		private readonly getAgentCwd: (agentId: string) => string,
		private readonly emit: Emit,
	) {}

	list(agentId: string) {
		return [...(this.runtimes.get(agentId)?.values() ?? [])].map(
			(runtime) => runtime.tab,
		);
	}

	ensure(agentId: string) {
		const existing = this.list(agentId);
		if (existing.length > 0) return existing;
		// Renderer 在 StrictMode 下会重复触发 mount effect；这里提供原子兜底，
		// 避免 list -> create 两步之间的竞态导致“未点击却多出两个终端”。
		return [this.create(agentId)];
	}

	create(agentId: string): TerminalTab {
		const cwd = this.getAgentCwd(agentId);
		const runtimes = this.ensureAgent(agentId);
		const index = runtimes.size + 1;
		const id = randomUUID();
		const spawned = this.spawnShell(cwd);
		const tab: TerminalTab = {
			id,
			agentId,
			title: `${this.displayShell(spawned.shell)} ${index}`,
			cwd,
			shell: spawned.shell,
			createdAt: Date.now(),
		};
		const runtime: TerminalRuntime = { tab, pty: spawned.pty };
		runtimes.set(id, runtime);

		spawned.pty.onData((data) => {
			this.emit(ipcChannels.terminalData, { tabId: id, data });
		});
		spawned.pty.onExit((event) => {
			tab.exited = true;
			tab.exitCode = event.exitCode;
			this.emit(ipcChannels.terminalExit, {
				tabId: id,
				exitCode: event.exitCode,
			});
		});

		return tab;
	}

	input(tabId: string, data: string) {
		const runtime = this.requireTab(tabId);
		if (runtime.tab.exited) return;
		runtime.pty.write(data);
	}

	resize(tabId: string, cols: number, rows: number) {
		const runtime = this.requireTab(tabId);
		if (runtime.tab.exited) return;
		runtime.pty.resize(Math.max(2, cols), Math.max(1, rows));
	}

	close(tabId: string) {
		const found = this.findRuntime(tabId);
		if (!found) return;
		found.runtime.pty.kill();
		found.tabs.delete(tabId);
		if (found.tabs.size === 0) this.runtimes.delete(found.runtime.tab.agentId);
	}

	closeAgent(agentId: string) {
		const tabs = this.runtimes.get(agentId);
		if (!tabs) return;
		for (const runtime of tabs.values()) {
			runtime.pty.kill();
		}
		this.runtimes.delete(agentId);
	}

	closeAll() {
		for (const agentId of this.runtimes.keys()) {
			this.closeAgent(agentId);
		}
	}

	private ensureAgent(agentId: string) {
		const existing = this.runtimes.get(agentId);
		if (existing) return existing;
		const next = new Map<string, TerminalRuntime>();
		this.runtimes.set(agentId, next);
		return next;
	}

	private requireTab(tabId: string) {
		const found = this.findRuntime(tabId);
		if (!found) throw new Error(`Terminal not found: ${tabId}`);
		return found.runtime;
	}

	private findRuntime(tabId: string) {
		for (const tabs of this.runtimes.values()) {
			const runtime = tabs.get(tabId);
			if (runtime) return { tabs, runtime };
		}
		return undefined;
	}

	private spawnShell(cwd: string): { shell: TerminalShell; pty: pty.IPty } {
		const candidates = this.shellCandidates();
		let lastError: unknown;
		for (const candidate of candidates) {
			try {
				const terminal = pty.spawn(candidate.command, [], {
					name: "xterm-256color",
					cols: 80,
					rows: 24,
					cwd,
					env: process.env,
				});
				return { shell: candidate.shell, pty: terminal };
			} catch (error) {
				lastError = error;
			}
		}
		throw lastError instanceof Error
			? lastError
			: new Error("No supported shell found");
	}

	private shellCandidates(): Array<{ shell: TerminalShell; command: string }> {
		if (process.platform === "win32") {
			return [
				{ shell: "pwsh", command: "pwsh.exe" },
				{ shell: "powershell", command: "powershell.exe" },
				{ shell: "cmd", command: "cmd.exe" },
			];
		}
		return [
			{ shell: "sh", command: process.env.SHELL || "sh" },
			{ shell: "sh", command: "bash" },
			{ shell: "sh", command: "sh" },
		];
	}

	private displayShell(shell: TerminalShell) {
		if (shell === "pwsh" || shell === "powershell") return "PowerShell";
		if (shell === "cmd") return "cmd";
		return "shell";
	}
}
