/**
 * dsh-memory: Codex-like persistent memory for DeepSeek Harness.
 *
 * @module dsh-memory
 */
import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'

/** Loader configuration for the dsh-memory plugin. */
export interface MemoryConfig {
  /** Memory directory; empty defaults to `$DSH_HOME/memories`. */
  memoryDir?: string
  /** Byte budget for the injected summary (default 8000). */
  maxBytes?: number
  /** Byte budget for the consolidation input sent to the merge model (default 40000). */
  consolidateMaxBytes?: number
  /** Number of previous summary versions retained for rollback (default 20, 0 disables history). */
  keepSummaryVersions?: number
  /** Byte threshold above which oldest raw entries are archived (default 200000). */
  rawArchiveMaxBytes?: number
  /** Distill turns into rollout summaries (default true). */
  autoSummarize?: boolean
  /** Provider used for summarization; defaults to the selected agent model. */
  summarizeProvider?: string
  /** Model used for summarization; defaults to the selected agent model. */
  summarizeModel?: string
  /** Minimum interval between summaries for one session in milliseconds (default 300000; 0 disables debounce). */
  summarizeDebounceMs?: number
  /** Rollout summaries written before re-consolidating the global summary (default 3). */
  consolidateEvery?: number
  /** Maximum output tokens for turn summarization (default 600). */
  summaryMaxTokens?: number
  /** Maximum output tokens for summary consolidation (default 1500). */
  consolidateMaxTokens?: number
  /** Retries after a transient LLM failure (default 1). */
  llmRetries?: number
  /** Maximum concurrent turn summarizations before new jobs are dropped (default 4). */
  maxActiveSummaries?: number
  /** Enable per-workspace memory scopes (default false). */
  scopedMemory?: boolean
  /** Injected byte budget for the workspace-scoped summary when scopedMemory is enabled (default 2400). */
  scopeMaxBytes?: number
  /** Redact detected credential patterns from injected summaries (default true). */
  redactSecrets?: boolean
  /** Scope keys that are read-only for write tools ('global', exact ws/project keys, or '*' for all). */
  readOnlyScopes?: string[]
  /** OpenAI-compatible embedding base URL used when `vector:true` (empty = local hashed vectors). */
  embeddingBaseURL?: string
  /** Bearer API key for the embedding endpoint. */
  embeddingApiKey?: string
  /** Embedding model id sent to the endpoint. */
  embeddingModel?: string
  /** Seed the first summary from `$DSH_HOME/AGENTS.md` (default true). */
  seedFromAgentsMd?: boolean
}

/** Schemastery schema of {@link MemoryConfig}. */
export const Config: z<MemoryConfig>

/** Stable plugin name used by the Loader. */
export const name: 'dsh-memory'

/** Cordis plugin entry. */
export function apply(ctx: Context, config?: MemoryConfig): void
