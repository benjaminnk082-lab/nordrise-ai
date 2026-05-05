/**
 * routing.ts — pickModel heuristic for the "auto" default.
 *
 * Returned model is either a Claude id (claude-opus-4-7, claude-sonnet-4-6,
 * claude-haiku-4-5) or the synthetic `ollama:<model>` form which the renderer
 * routes to the Ollama IPC bridge instead of Sean's backend.
 */

export type RoutedModel = string;

export interface RoutingContext {
  text: string;
  hasAttachments: boolean;
  /** From AppSettings.defaultModel — when not "auto", this is returned as-is. */
  defaultModel: string;
  ollamaAvailable: boolean;
  ollamaModel: string;
  preferOllamaForSimple: boolean;
}

export function pickModel(ctx: RoutingContext): RoutedModel {
  if (ctx.defaultModel !== 'auto') return ctx.defaultModel;

  const isSimple =
    ctx.text.length < 200 &&
    !ctx.hasAttachments &&
    !/```|\bcode\b|\bdebug\b|\bfix\b/i.test(ctx.text);

  if (isSimple) {
    if (ctx.preferOllamaForSimple && ctx.ollamaAvailable && ctx.ollamaModel) {
      return `ollama:${ctx.ollamaModel}`;
    }
    return 'claude-haiku-4-5';
  }

  const isComplex =
    ctx.hasAttachments || /```/.test(ctx.text) || ctx.text.length > 1500;

  return isComplex ? 'claude-opus-4-7' : 'claude-sonnet-4-6';
}
