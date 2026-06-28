import type { AuthFile, SettingsFile, ModelsFile } from "./configTypes";
import { ConfigComboboxInput } from "./ConfigShared";
import { t } from "../i18n";

// ── Settings Tab ────────────────────────────────────────

export function SettingsTab(props: {
	data: SettingsFile;
	saving: boolean;
	/** 已配置的模型/服务商数据，用于 defaultProvider / defaultModel 下拉选项 */
	modelsData?: ModelsFile;
	/** 已配置的认证数据，配合 modelsData 一起为 defaultProvider 聚合所有可用的供应商 */
	authData?: AuthFile;
	/** 通过已知端点自动发现的模型（auth-only 供应商） */
	discoveredModels?: Record<string, Array<{ id: string; name?: string }>>;
	onChange: (data: SettingsFile) => void;
	onSave: () => void;
}) {
	const { data, saving } = props;
	const entries = Object.entries(data);

	return (
		<div className="config-settings-tab">
			<div className="config-toolbar">
				<span className="config-count">
					{t("config.count.configItems", { count: entries.length })}
				</span>
				<button
					className="config-btn primary"
					onClick={props.onSave}
					disabled={saving}
				>
					{saving ? t("common.saving") : t("common.save")}
				</button>
			</div>
			<div className="config-settings-list">
				{entries.map(([key, value]) => (
					<div key={key} className="config-settings-row">
						<span className="config-settings-key">{key}</span>
						<SettingsValueInput
							value={value}
							fieldKey={key}
							modelsData={props.modelsData}
							authData={props.authData}
							discoveredModels={props.discoveredModels}
							allSettings={data}
							onChange={(v) => props.onChange({ ...data, [key]: v })}
						/>
					</div>
				))}
				{entries.length === 0 && <div className="config-empty">{t("config.emptyConfig")}</div>}
			</div>
		</div>
	);
}

function SettingsValueInput(props: {
	value: unknown;
	fieldKey: string;
	modelsData?: ModelsFile;
	authData?: AuthFile;
	discoveredModels?: Record<string, Array<{ id: string; name?: string }>>;
	allSettings?: SettingsFile;
	onChange: (v: unknown) => void;
}) {
	const { value, fieldKey, modelsData, authData, discoveredModels, allSettings } = props;

	// defaultProvider: 从 modelsData.providers + authData 的 key 列表聚合所有可用的供应商
	if (fieldKey === "defaultProvider") {
		const providerSet = new Set<string>();
		if (modelsData) {
			for (const name of Object.keys(modelsData.providers)) {
				providerSet.add(name);
			}
		}
		if (authData) {
			for (const name of Object.keys(authData)) {
				providerSet.add(name);
			}
		}
		const providerOptions = [...providerSet].map((name) => ({ value: name }));
		return (
			<ConfigComboboxInput
				value={typeof value === "string" ? value : ""}
				options={providerOptions}
				onChange={(v) => props.onChange(v)}
				placeholder={t("config.settings.selectProvider")}
			/>
		);
	}

	// defaultModel: 根据当前选中的 defaultProvider 联动过滤
	if (fieldKey === "defaultModel") {
		const selectedProvider = allSettings?.["defaultProvider"];
		const selectedProviderName = typeof selectedProvider === "string" ? selectedProvider : "";
		const currentModel = typeof value === "string" ? value : "";
		const modelOptions: Array<{ value: string; label?: string }> = [];
		const seen = new Set<string>();

		// 始终将当前已配置的值作为首选项，确保已生效的配置在列表中可见
		if (currentModel && !seen.has(currentModel)) {
			seen.add(currentModel);
			const currentLabel = selectedProviderName
				? `${currentModel} (${selectedProviderName})`
				: currentModel;
			modelOptions.push({ value: currentModel, label: currentLabel });
		}

		if (selectedProviderName) {
			// 优先从模型配置中取该供应商的模型
			const provider = modelsData?.providers[selectedProviderName];
			if (provider) {
				for (const model of provider.models) {
					if (!seen.has(model.id)) {
						seen.add(model.id);
						const label = model.name && model.name !== model.id
							? `${model.name} (${selectedProviderName})`
							: `${model.id} (${selectedProviderName})`;
						modelOptions.push({ value: model.id, label });
					}
				}
			}
			// 尝试从自动发现的模型中获取（auth-only 供应商通过已知端点获取）
			const discovered = discoveredModels?.[selectedProviderName];
			if (discovered) {
				for (const model of discovered) {
					if (!seen.has(model.id)) {
						seen.add(model.id);
						modelOptions.push({
							value: model.id,
							label: model.name
								? `${model.name} (${selectedProviderName})`
								: `${model.id} (${selectedProviderName})`,
						});
					}
				}
			}
			// 如果该供应商只有 auth 没有模型配置，尝试从 auth 条目的 model 字段获取
			const authEntry = authData?.[selectedProviderName];
			if (authEntry && typeof authEntry.model === "string" && authEntry.model && !seen.has(authEntry.model)) {
				seen.add(authEntry.model);
				modelOptions.push({ value: authEntry.model, label: `${authEntry.model} (${selectedProviderName})` });
			}
		} else {
			// 未选择供应商时，展示全部模型的精简列表供参考
			if (modelsData) {
				for (const [pName, provider] of Object.entries(modelsData.providers)) {
					for (const model of provider.models) {
						if (!seen.has(model.id)) {
							seen.add(model.id);
							const label = model.name && model.name !== model.id
								? `${model.name} (${pName})`
								: `${model.id} (${pName})`;
							modelOptions.push({ value: model.id, label });
						}
					}
				}
			}
			if (authData) {
				for (const [pName, auth] of Object.entries(authData)) {
					if (typeof auth.model === "string" && auth.model && !seen.has(auth.model)) {
						seen.add(auth.model);
						modelOptions.push({ value: auth.model, label: `${auth.model} (${pName})` });
					}
				}
			}
			// 从自动发现的模型中获取
			if (discoveredModels) {
				for (const [pName, models] of Object.entries(discoveredModels)) {
					for (const model of models) {
						if (!seen.has(model.id)) {
							seen.add(model.id);
							modelOptions.push({
								value: model.id,
								label: model.name
									? `${model.name} (${pName})`
									: `${model.id} (${pName})`,
							});
						}
					}
				}
			}
		}

		return (
			<ConfigComboboxInput
				value={typeof value === "string" ? value : ""}
				options={modelOptions}
				onChange={(v) => props.onChange(v)}
				placeholder={selectedProviderName
					? t("config.settings.selectModelFor", { provider: selectedProviderName })
					: t("config.settings.selectModelFirst")}
			/>
		);
	}

	if (typeof value === "boolean") {
		return (
			<label className="config-checkbox-label">
				<input
					type="checkbox"
					checked={value}
					onChange={(e) => props.onChange(e.target.checked)}
				/>
				<span>{value ? "true" : "false"}</span>
			</label>
		);
	}
	if (typeof value === "number") {
		return (
			<input
				type="number"
				value={value}
				onChange={(e) => props.onChange(Number(e.target.value))}
				className="config-settings-input"
			/>
		);
	}
	if (typeof value === "string") {
		return (
			<input
				value={value}
				onChange={(e) => props.onChange(e.target.value)}
				className="config-settings-input"
			/>
		);
	}
	return (
		<input
			value={JSON.stringify(value)}
			onChange={(e) => {
				try {
					props.onChange(JSON.parse(e.target.value));
				} catch {
					/* 输入过程中 JSON 不合法时暂不更新 */
				}
			}}
			className="config-settings-input"
		/>
	);
}


