import { memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Eye, Pencil, Download } from "lucide-react";
import { t } from "../../i18n";
import { CloseIconButton, IconButton } from "../ui/IconButton";

function ToolButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
	return (
		<IconButton label={label} onClick={onClick} className="scratch-pad-tool-btn">
			{icon}
		</IconButton>
	);
}

type ScratchPadPanelProps = {
	content: string;
	mode: "edit" | "preview";
	isClosing?: boolean;
	isSaving: boolean;
	hasError: boolean;
	onChangeContent: (value: string) => void;
	onSetMode: (mode: "edit" | "preview") => void;
	onExport: () => void;
	onClose: () => void;
};

export const ScratchPadPanel = memo(function ScratchPadPanel(props: ScratchPadPanelProps) {
	const {
		content,
		mode,
		isClosing,
		isSaving,
		hasError,
		onChangeContent,
		onSetMode,
		onExport,
		onClose,
	} = props;

	const handleToggleMode = () => {
		onSetMode(mode === "edit" ? "preview" : "edit");
	};

	return (
		<div
			className={"scratch-pad-panel" + (isClosing ? " closing" : "")}
			onClick={(event) => event.stopPropagation()}
		>
			<header className="scratch-pad-header">
				<div className="scratch-pad-title">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M12 20h9" />
						<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
					</svg>
					<span>{t("scratchPad.title")}</span>
					<kbd className="scratch-pad-kbd">⌘⇧S</kbd>
				</div>
				<div className="scratch-pad-toolbar">
					<ToolButton
						icon={mode === "edit" ? <Eye size={15} /> : <Pencil size={15} />}
						label={mode === "edit" ? t("scratchPad.preview") : t("scratchPad.edit")}
						onClick={handleToggleMode}
					/>
					<ToolButton
						icon={<Download size={15} />}
						label={t("scratchPad.export")}
						onClick={onExport}
					/>
					<CloseIconButton
						label={t("scratchPad.close")}
						onClick={onClose}
					/>
				</div>
			</header>

			<div className="scratch-pad-content">
				{mode === "edit" ? (
					<textarea
						className="scratch-pad-editor"
						value={content}
						placeholder={t("scratchPad.placeholder")}
						onChange={(e) => onChangeContent(e.target.value)}
						autoFocus
						spellCheck={false}
					/>
				) : (
					<div className="scratch-pad-preview markdown-body">
						<ReactMarkdown
							remarkPlugins={[remarkGfm, remarkMath]}
							rehypePlugins={[rehypeKatex]}
						>
							{content || `_${t("scratchPad.empty")}_`}
						</ReactMarkdown>
					</div>
				)}
			</div>

			<div className={`scratch-pad-status${hasError ? " error" : ""}`}>
				<span className="scratch-pad-status-text">
					{hasError
						? t("scratchPad.saveError")
						: isSaving
							? t("scratchPad.saving")
							: content
								? t("scratchPad.saved")
								: ""}
				</span>
			</div>
		</div>
	);
});
