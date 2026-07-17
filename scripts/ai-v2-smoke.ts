import {
  FABRIC_AI_PROVIDER,
  parseAiApiKeys,
  parseAiRuntimeConfig,
} from "../lib/ai/config";
import { BoardPlanSchema, BOARD_PLAN_JSON_SCHEMA } from "../lib/ai/engine/board-plan";
import { buildAuthorizedBoardScene } from "../lib/ai/engine/authorized-scene";
import { compileBoardProposal } from "../lib/ai/engine/compiler";
import { OpenAiCompatibleChatProvider } from "../lib/ai/providers/openai-compatible";
import {
  buildBoardAssistanceInput,
  CANVAS_AGENT_SKILL,
} from "../lib/ai/skills/board-assistance.v1";

function structuralPlanFailure(parsedJson: unknown): Error {
  const rootKeys = parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)
    ? Object.keys(parsedJson).sort()
    : [];
  const actions = parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson) &&
    "actions" in parsedJson && Array.isArray(parsedJson.actions)
    ? parsedJson.actions.map((action) =>
        action && typeof action === "object" && !Array.isArray(action)
          ? {
              keys: Object.keys(action).sort(),
              kind: "kind" in action ? String(action.kind) : null,
              type: "type" in action ? String(action.type) : null,
              contentShape: "content" in action
                ? Array.isArray(action.content)
                  ? "array"
                  : typeof action.content
                : "missing",
            }
          : { keys: [], kind: null, type: null, contentShape: "invalid" },
      )
    : [];
  return new Error(
    `BoardPlan validation failed; root keys: ${rootKeys.join(",") || "none"}; action shapes: ${JSON.stringify(actions)}`,
  );
}

async function main(): Promise<void> {
  const config = parseAiRuntimeConfig({
    provider: process.env.AI_PROVIDER ?? FABRIC_AI_PROVIDER,
    baseUrl: process.env.AI_BASE_URL,
    apiKeys: parseAiApiKeys({
      AI_API_KEYS: process.env.AI_API_KEYS,
      AI_API_KEY: process.env.AI_API_KEY,
    }),
    model: process.env.AI_MODEL,
    streamOnly: process.env.AI_STREAM_ONLY === "true",
    requestTimeoutMs: CANVAS_AGENT_SKILL.manifest.limits.maxWallTimeMs,
  });
  const scene = buildAuthorizedBoardScene({
    snapshot: { nodes: [], edges: [] },
    selection: [],
    viewport: { x: 0, y: 0, width: 1_200, height: 800 },
  });
  const request = {
    skill: "canvas-agent" as const,
    workspaceId: "smoke-workspace",
    boardId: "smoke-board",
    documentGenerationId: "smoke-generation",
    durableSequence: 1,
    instruction: "Solve 2x + 3 = 11. Put concise exact steps and the answer on the board.",
    selection: [],
    viewport: scene.viewport,
    conversation: [],
    scene,
  };
  const provider = new OpenAiCompatibleChatProvider(config);
  const startedAt = performance.now();
  let firstContentAt: number | null = null;
  let output = "";
  let usage = {};
  const turn = await provider.createTurn({
    input: buildBoardAssistanceInput(request),
    systemInstruction: CANVAS_AGENT_SKILL.systemInstruction,
    thinkingLevel: CANVAS_AGENT_SKILL.manifest.thinkingLevel,
    maxOutputTokens: CANVAS_AGENT_SKILL.manifest.limits.maxOutputTokens,
    responseSchema: BOARD_PLAN_JSON_SCHEMA,
    timeoutMs: CANVAS_AGENT_SKILL.manifest.limits.maxWallTimeMs,
  });
  for await (const event of turn.events) {
    if (event.type === "text_delta") {
      firstContentAt ??= performance.now();
      output += event.text;
    } else if (event.type === "interaction_completed") {
      usage = event.usage;
    }
  }
  const parsedJson: unknown = JSON.parse(output);
  const planResult = BoardPlanSchema.safeParse(parsedJson);
  if (!planResult.success) throw structuralPlanFailure(parsedJson);
  const plan = planResult.data;
  const patch = plan.kind === "proposal"
    ? compileBoardProposal({
        proposal: plan,
        scene,
        base: {
          workspaceId: request.workspaceId,
          boardId: request.boardId,
          documentGenerationId: request.documentGenerationId,
          durableSequence: request.durableSequence,
        },
      })
    : null;
  const finishedAt = performance.now();
  const compiledText = JSON.stringify(patch);
  const containsExpectedAnswer = /x\s*=\s*4/iu.test(compiledText);
  if (plan.kind !== "proposal" || !patch || !containsExpectedAnswer) {
    throw new Error("The synthetic math smoke test did not produce the expected answer proposal.");
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    kind: plan.kind,
    ttfcMs: firstContentAt === null ? null : Math.round(firstContentAt - startedAt),
    totalMs: Math.round(finishedAt - startedAt),
    outputBytes: new TextEncoder().encode(output).byteLength,
    operationCount: patch.operations.length,
    containsExpectedAnswer,
    usesLossyPenText: patch.operations.some((operation) => operation.type === "writeText"),
    usage,
  })}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown smoke-test failure";
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
