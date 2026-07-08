import { app, dialog } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, normalize, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Project } from "../../shared/types";

const CHAT_PROJECT_ID = "builtin-chat";
const CHAT_PROJECT_NAME = "Chat";

export class ProjectStore {
  private readonly filePath = join(app.getPath("userData"), "projects.json");
  private readonly chatProjectPath = join(app.getPath("userData"), "chat-workspace");
  private projects: Project[] = [];

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.projects = JSON.parse(raw) as Project[];
    } catch {
      this.projects = [];
    }
    const chatChanged = this.ensureChatProject();
    const orderChanged = this.ensureSortOrder();
    const changed = chatChanged || orderChanged;
    await mkdir(this.chatProjectPath, { recursive: true });
    if (changed) await this.save();
    return this.list();
  }

  list() {
    return [...this.projects].sort((a, b) =>
      Number(this.isChatProject(b)) - Number(this.isChatProject(a))
      || Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
      || this.projectSortOrder(a) - this.projectSortOrder(b)
      || b.lastOpenedAt - a.lastOpenedAt
    );
  }

  get(id: string) {
    return this.projects.find(project => project.id === id);
  }

  async chooseAndAdd() {
    const result = await dialog.showOpenDialog({
      title: "选择项目目录",
      properties: ["openDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return this.add(result.filePaths[0]);
  }

  async add(path: string, worktreeParentId?: string) {
    const normalizedPath = this.normalizeProjectPath(path);
    const existing = this.projects.find(project => this.sameProjectPath(project.path, normalizedPath));
    if (existing) {
      existing.path = normalizedPath;
      existing.lastOpenedAt = Date.now();
      // 外部已有 worktree 可能曾经作为顶级项目加入；开启工作区后需要补上父子关系。
      if (worktreeParentId && existing.id !== worktreeParentId) {
        existing.worktreeParentId = worktreeParentId;
        existing.pinned = false;
      }
      await this.save();
      return existing;
    }

    const project: Project = {
      id: randomUUID(),
      name: basename(normalizedPath) || normalizedPath,
      path: normalizedPath,
      lastOpenedAt: Date.now(),
      sortOrder: this.nextSortOrder(),
      ...(worktreeParentId ? { worktreeParentId } : {}),
    };

    this.projects.push(project);
    await this.save();
    return project;
  }

  async remove(id: string) {
    // 删除父项目时同步移除子项目记录，避免留下不可见的孤儿 worktree 项目。
    this.projects = this.projects.filter(project =>
      (project.id !== id && project.worktreeParentId !== id) || this.isChatProject(project),
    );
    await this.save();
  }

  async reorder(projectIds: string[]) {
    const movableProjectIds = projectIds.filter((id) => id !== CHAT_PROJECT_ID);
    const orderById = new Map(movableProjectIds.map((id, index) => [id, index]));
    const tailStart = movableProjectIds.length;
    const currentOrder = this.list()
      .filter((project) => !this.isChatProject(project))
      .map((project) => project.id);

    this.projects.forEach((project) => {
      if (this.isChatProject(project)) {
        project.sortOrder = -1;
        return;
      }
      const explicitOrder = orderById.get(project.id);
      project.sortOrder = explicitOrder ?? tailStart + currentOrder.indexOf(project.id);
    });

    await this.save();
    return this.list();
  }

  private ensureChatProject() {
    const existing = this.projects.find(
      (project) =>
        this.isChatProject(project) ||
        project.id === CHAT_PROJECT_ID ||
        project.path === this.chatProjectPath,
    );
    const nextChatProject: Project = {
      id: CHAT_PROJECT_ID,
      name: CHAT_PROJECT_NAME,
      path: this.chatProjectPath,
      lastOpenedAt: existing?.lastOpenedAt ?? Date.now(),
      pinned: true,
      sortOrder: -1,
      kind: "chat",
    };

    if (!existing) {
      this.projects.unshift(nextChatProject);
      return true;
    }

    const previousLength = this.projects.length;
    const changed =
      existing.id !== nextChatProject.id ||
      existing.name !== nextChatProject.name ||
      existing.path !== nextChatProject.path ||
      existing.kind !== nextChatProject.kind ||
      existing.pinned !== nextChatProject.pinned ||
      existing.sortOrder !== nextChatProject.sortOrder;
    Object.assign(existing, nextChatProject);
    this.projects = this.projects.filter(
      (project, index) =>
        index === this.projects.indexOf(existing) ||
        (!this.isChatProject(project) &&
          project.id !== CHAT_PROJECT_ID &&
          project.path !== this.chatProjectPath),
    );
    return changed || this.projects.length !== previousLength;
  }

  private ensureSortOrder() {
    const needsOrder = this.projects.some(
      (project) => typeof project.sortOrder !== "number" || Number.isNaN(project.sortOrder),
    );
    if (!needsOrder) return false;

    // 首次升级旧数据时保留原来的“置顶优先 + 最近打开”顺序，之后由用户拖拽顺序接管。
    [...this.projects]
      .filter((project) => !this.isChatProject(project))
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.lastOpenedAt - a.lastOpenedAt)
      .forEach((project, index) => {
        project.sortOrder = index;
      });
    const chatProject = this.projects.find((project) => this.isChatProject(project));
    if (chatProject) chatProject.sortOrder = -1;
    return true;
  }

  private nextSortOrder() {
    if (this.projects.length === 0) return 0;
    return Math.max(...this.projects.map((project) => this.projectSortOrder(project))) + 1;
  }

  private projectSortOrder(project: Project) {
    return typeof project.sortOrder === "number" && !Number.isNaN(project.sortOrder)
      ? project.sortOrder
      : Number.MAX_SAFE_INTEGER;
  }

  /** 仅返回顶级项目（非 worktree 子项目），用于侧栏主列表 */
  listRoot() {
    return this.list().filter(p => !p.worktreeParentId);
  }

  /** 获取指定父项目的所有 worktree 子项目 */
  listWorktreeChildren(parentId: string) {
    return this.list().filter(p => p.worktreeParentId === parentId);
  }

  /** 按路径查找项目；Windows 上忽略大小写和分隔符差异。 */
  findByPath(path: string) {
    const normalizedPath = this.normalizeProjectPath(path);
    return this.projects.find(project => this.sameProjectPath(project.path, normalizedPath)) ?? null;
  }

  async toggleWorktreeEnabled(id: string) {
    const project = this.get(id);
    if (!project) return null;
    project.worktreeEnabled = !project.worktreeEnabled;
    await this.save();
    return project;
  }

  private isChatProject(project: Project) {
    return project.kind === "chat" || project.id === CHAT_PROJECT_ID;
  }

  private normalizeProjectPath(path: string) {
    return normalize(resolve(path));
  }

  private sameProjectPath(a: string, b: string) {
    const left = this.normalizeProjectPath(a);
    const right = this.normalizeProjectPath(b);
    return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
  }

  private async save() {
    // 项目列表是桌面端自己的轻量状态，不写入 pi session，避免影响 pi 原生会话格式。
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.projects, null, 2), "utf8");
  }
}
