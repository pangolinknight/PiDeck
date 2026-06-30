import { useCallback, useEffect, useRef, useState } from "react";
import type { ScratchPadData } from "../../../shared/types";

const AUTOSAVE_DELAY = 1500;

type UseScratchPadResult = {
	isOpen: boolean;
	isClosing: boolean;
	content: string;
	mode: "edit" | "preview";
	isSaving: boolean;
	hasError: boolean;
	open: () => void;
	close: () => void;
	toggle: () => void;
	setContent: (value: string) => void;
	setMode: (mode: "edit" | "preview") => void;
	saveNow: () => Promise<void>;
	exportFile: () => Promise<void>;
};

export function useScratchPad(): UseScratchPadResult {
	const [isOpen, setIsOpen] = useState(false);
	const [isClosing, setIsClosing] = useState(false);
	const [content, setContentState] = useState("");
	const [mode, setMode] = useState<"edit" | "preview">("edit");
	const [isSaving, setIsSaving] = useState(false);
	const [hasError, setHasError] = useState(false);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isFirstLoadRef = useRef(true);

	// 启动时加载
	useEffect(() => {
		if (!window.piDesktop?.scratchPad) return;
		window.piDesktop.scratchPad.load().then((data: ScratchPadData) => {
			setContentState(data.content ?? "");
		});
	}, []);

	const flushSave = useCallback(async (value: string) => {
		if (!window.piDesktop?.scratchPad) return;
		setIsSaving(true);
		setHasError(false);
		try {
			await window.piDesktop.scratchPad.save(value, 0);
		} catch {
			setHasError(true);
		} finally {
			setIsSaving(false);
		}
	}, []);

	const setContent = useCallback(
		(value: string) => {
			setContentState(value);
			setHasError(false);
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
			saveTimerRef.current = setTimeout(() => {
				void flushSave(value);
			}, AUTOSAVE_DELAY);
		},
		[flushSave],
	);

	const close = useCallback(() => {
		if (isClosing) return;
		setIsClosing(true);
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		void flushSave(content);
		setTimeout(() => {
			setIsOpen(false);
			setIsClosing(false);
		}, 200);
	}, [content, flushSave, isClosing]);

	const open = useCallback(() => {
		setIsClosing(false);
		setIsOpen(true);
		isFirstLoadRef.current = false;
	}, []);

	const toggle = useCallback(() => {
		if (isOpen) {
			close();
		} else {
			open();
		}
	}, [isOpen, open, close]);

	const saveNow = useCallback(() => {
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		return flushSave(content);
	}, [content, flushSave]);

	const exportFile = useCallback(async () => {
		await saveNow();
		await window.piDesktop?.scratchPad?.export();
	}, [saveNow]);

	// 应用退出前保存
	useEffect(() => {
		const handler = () => {
			if (content && window.piDesktop?.scratchPad) {
				void window.piDesktop.scratchPad.save(content, 0);
			}
		};
		window.addEventListener("beforeunload", handler);
		return () => window.removeEventListener("beforeunload", handler);
	}, [content]);

	return {
		isOpen,
		isClosing,
		content,
		mode,
		isSaving,
		hasError,
		open,
		close,
		toggle,
		setContent,
		setMode,
		saveNow,
		exportFile,
	};
}
