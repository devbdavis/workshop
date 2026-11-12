export interface TuiPromptOption {
  n: number;
  label: string;
  description?: string;
  /** Present only for multiSelect rows. */
  checked?: boolean;
}

/** An interactive Claude Code dialog read off the tmux screen. */
export interface TuiPrompt {
  question: string;
  options: TuiPromptOption[];
  hasSubmitTab: boolean;
  screen: string[];
}
