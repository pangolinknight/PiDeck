import { useCallback, useEffect, useRef, useState } from "react";
import { DiffEditor, Editor } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { t } from "../../i18n";
import { Columns3, Edit3, Maximize2, X } from "lucide-react";
import { setupMonaco } from "../../utils/monacoSetup";

let monacoSetupOnce = false;
function ensureMonaco() {
	if (monacoSetupOnce) return;
	monacoSetupOnce = true;
	setupMonaco();
}

type ViewMode = "view" | "diff";

export function FileDiffViewer(props: {
	filePath: string;
	mode?: ViewMode;
	onClose: () => void;
	readContent: (path: string) => Promise<string>;
	saveContent?: (path: string, content: string) => Promise<void>;
	theme?: "light" | "dark";
}) {
	const [content, setContent] = useState("");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [sideBySide, setSideBySide] = useState(true);
	const [readOnly, setReadOnly] = useState(true);
	const [loadedPath, setLoadedPath] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);

	const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
	const diffEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);

	const isDiffMode = props.mode === "diff";

	useEffect(() => {
		ensureMonaco();
		if (loadedPath === props.filePath) return;

		let cancelled = false;
		async function load() {
			setLoading(true);
			setError(null);
			setDirty(false);
			try {
				const result = await props.readContent(props.filePath);
				if (!cancelled) {
					setContent(result);
					setLoadedPath(props.filePath);
					if (result === "" && !loading) {
						// 文件可能已被删除或为空
						setError(t("config.fileDeletedOrEmpty"));
					}
				}
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
		}
		void load();
		return () => { cancelled = true; };
	}, [props.filePath, props.readContent, loadedPath]);

	const handleClose = useCallback(() => {
		props.onClose();
	}, [props.onClose]);

	const handleEditToggle = useCallback(async () => {
		if (readOnly) {
			setReadOnly(false);
		} else {
			if (dirty && content !== null && props.saveContent) {
				setSaving(true);
				try {
					await props.saveContent(props.filePath, content);
					setDirty(false);
				} catch (e) {
					setError(e instanceof Error ? e.message : String(e));
				} finally {
					setSaving(false);
				}
			}
			setReadOnly(true);
		}
	}, [readOnly, dirty, content, props.filePath, props.saveContent]);

	const handleEditorChange = useCallback((value: string | undefined) => {
		if (value !== undefined) {
			setContent(value);
			setDirty(true);
		}
	}, []);

	const handleEditorMount = useCallback((editor: Monaco.editor.IStandaloneCodeEditor) => {
		editorRef.current = editor;
	}, []);

	const handleDiffEditorMount = useCallback((editor: Monaco.editor.IStandaloneDiffEditor) => {
		diffEditorRef.current = editor;
	}, []);

	// 组件卸载前先清理 Monaco 编辑器引用，避免异步清理造成 TextModel disposed 竞态。
	useEffect(() => {
		return () => {
			editorRef.current?.dispose();
			diffEditorRef.current?.dispose();
			editorRef.current = null;
			diffEditorRef.current = null;
		};
	}, []);

	const fileName = props.filePath.split(/[/\\]/).pop() ?? props.filePath;
	const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
	const language = extToMonacoLanguage(ext);

	const editorOptions: Monaco.editor.IStandaloneEditorConstructionOptions = {
		readOnly,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		lineNumbers: "on",
		folding: true,
		automaticLayout: true,
	};

	const diffOptions: Monaco.editor.IStandaloneDiffEditorConstructionOptions = {
		...editorOptions,
		readOnly: true,
		renderSideBySide: sideBySide,
	};

	return (
		<div className="modal-backdrop" onClick={readOnly ? handleClose : undefined}>
			<div className="file-diff-modal" onClick={(e) => e.stopPropagation()}>
				<div className="file-diff-header">
					<span className="file-diff-title" title={props.filePath}>
						{fileName}
						{dirty && " · 未保存"}
					</span>
					<div className="file-diff-header-actions">
						{isDiffMode && !loading && !error && (
							<button
								className="file-diff-toggle-btn"
								title={sideBySide ? t("app.showSingle") : t("app.showSplit")}
								onClick={() => setSideBySide(!sideBySide)}
							>
								{sideBySide ? <Maximize2 size={15} /> : <Columns3 size={15} />}
							</button>
						)}
						{props.saveContent && (
							<button
								className="file-diff-toggle-btn"
								title={readOnly ? t("app.editFile") : (saving ? t("common.saving") : t("app.saveFile"))}
								onClick={handleEditToggle}
								disabled={saving}
							>
								<Edit3 size={15} />
							</button>
						)}
						<button className="file-diff-close" onClick={handleClose} aria-label={t("common.close")}>
							<X size={18} />
						</button>
					</div>
				</div>
				<div className="file-diff-body">
					{loading && <div className="file-diff-loading">{t("common.loading")}</div>}
					{error && <div className="file-diff-error">{error}</div>}
					{!loading && !error && (
						<>
							<div style={{ display: isDiffMode ? "none" : "flex", height: "100%", flexDirection: "column" }}>
								<Editor
									value={content}
									language={language}
									theme={props.theme === "dark" ? "vs-dark" : "vs"}
									options={editorOptions}
									onMount={handleEditorMount}
									onChange={handleEditorChange}
								/>
							</div>
							<div style={{ display: !isDiffMode ? "none" : "flex", height: "100%", flexDirection: "column" }}>
								<DiffEditor
									original=""
									modified={content}
									language={language}
									theme={props.theme === "dark" ? "vs-dark" : "vs"}
									options={diffOptions}
									onMount={handleDiffEditorMount}
								/>
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function extToMonacoLanguage(ext: string): string {
	const map: Record<string, string> = {
		ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
		json: "json", jsonc: "json", md: "markdown", mdx: "markdown", css: "css", scss: "scss", less: "less",
		html: "html", htm: "html", yaml: "yaml", yml: "yaml", xml: "xml", svg: "xml",
		sh: "shell", bash: "shell", zsh: "shell",
		py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", c: "c", "c++": "cpp", cpp: "cpp", h: "c", hpp: "cpp",
		sql: "sql", graphql: "graphql", gql: "graphql", proto: "protobuf", toml: "toml", ini: "ini", cfg: "ini", env: "dotenv",
		dockerfile: "dockerfile", makefile: "makefile",
	};
	return map[ext] ?? "plaintext";
}
