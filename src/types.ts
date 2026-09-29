/**
 * Minimal structural types for the host extension API.
 *
 * Studio declares the surface it uses instead of depending on the host package:
 * the package must stay installable and importable without the host toolchain,
 * and the plugin installer validates the entry point against a throwaway
 * registration surface at install time.
 */
export type NotifyLevel = "info" | "warning" | "error";


export interface StudioUi {
  notify?: (message: string, level?: NotifyLevel) => void;
  setStatus?: (key: string, value: string) => void;
  setEditorText?: (text: string) => void;
}

export interface SessionManagerLike {
  getBranch?: () => unknown[];
  getEntries?: () => unknown[];
}

export interface StudioContext {
  cwd?: string;
  ui?: StudioUi;
  sessionManager?: SessionManagerLike;
  hasUI?: boolean;
  agent?: { kind?: string };
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  details?: unknown;
  isError?: boolean;
}

export interface ToolDefinition<TParams = Record<string, unknown>> {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  promptSnippet?: string;
  execute: (
    toolCallId: string,
    params: TParams,
    signal: AbortSignal | undefined,
    onUpdate: ((update: ToolResult) => void) | undefined,
    ctx: StudioContext,
  ) => Promise<ToolResult>;
}

export interface CommandDefinition {
  description: string;
  aliases?: string[];
  getArgumentCompletions?: (prefix: string) => { value: string; label: string }[] | null;
  handler: (args: string, ctx: StudioContext) => Promise<void> | void;
}

export interface SendMessageOptions {
  deliverAs?: "steer" | "followUp" | "nextTurn" | "aside";
  attribution?: "user" | "agent";
}

export interface ExtensionAPI {
  on: (event: string, handler: (event: unknown, ctx: StudioContext) => unknown) => void;
  registerTool: (tool: ToolDefinition<never>) => void;
  registerCommand: (name: string, definition: CommandDefinition) => void;
  appendEntry?: (customType: string, data: unknown) => void;
  sendUserMessage?: (text: string, options?: SendMessageOptions) => void;
  setLabel?: (label: string) => void;
}
