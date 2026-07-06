/** Outcome of a single installer step — never throws, always reports */
export interface InstallStepResult {
  success: boolean;
  message: string;
}

/**
 * Provider-specific plugin installer (e.g. Claude Code plugin CLI, Gemini
 * extensions CLI). Implementations must fail soft: absent or too-old CLIs
 * report failure via the result, never throw.
 */
export interface PluginInstaller {
  /** True when the underlying CLI exists and supports plugin management */
  isAvailable(): Promise<boolean>;
  /** Idempotently register the marketplace repo (e.g. 'owner/repo') */
  ensureMarketplaceAdded(marketplaceRepo: string): Promise<InstallStepResult>;
  /** Idempotently install the plugin (e.g. 'ponytail@ponytail') */
  ensureInstalled(pluginName: string, marketplaceRepo: string): Promise<InstallStepResult>;
}
