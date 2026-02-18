import "server-only";

import { NodeHttpHandler } from "@smithy/node-http-handler";

type BedrockModule = typeof import("@aws-sdk/client-bedrock-runtime");
type BedrockClientLike = InstanceType<BedrockModule["BedrockRuntimeClient"]>;
type BedrockConverseCommandInput = ConstructorParameters<BedrockModule["ConverseCommand"]>[0];

type BedrockToolUse = {
  type?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
  input_json?: unknown;
  [key: string]: unknown;
};

type BedrockConverseResponse = {
  output?: {
    message?: {
      content?: Array<
        | { text?: string }
        | { type?: string; name?: string; input?: unknown }
        | Record<string, unknown>
      >;
    };
  };
  usage?: unknown;
  [key: string]: unknown;
};

let bedrockModulePromise: Promise<BedrockModule> | null = null;
let bedrockClient: BedrockClientLike | null = null;

const loadBedrockModule = async () => {
  if (!bedrockModulePromise) {
    bedrockModulePromise = import("@aws-sdk/client-bedrock-runtime");
  }
  return bedrockModulePromise;
};

const getBedrockClient = async () => {
  if (bedrockClient) return bedrockClient;
  const region = (process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "").trim();
  if (!region) throw new Error("AWS_REGION is missing for Bedrock PLP SEO.");
  const accessKeyId = (process.env.AWS_ACCESS_KEY_ID ?? process.env.BEDROCK_ACCESS_KEY ?? "").trim();
  const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY ?? "").trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY are missing for Bedrock PLP SEO.");
  }

  const sessionToken = (process.env.AWS_SESSION_TOKEN ?? "").trim();
  const { BedrockRuntimeClient } = await loadBedrockModule();
  bedrockClient = new BedrockRuntimeClient({
    region,
    credentials: sessionToken
      ? { accessKeyId, secretAccessKey, sessionToken }
      : { accessKeyId, secretAccessKey },
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 5000,
      socketTimeout: Math.max(5000, Number(process.env.PLP_SEO_BEDROCK_TIMEOUT_MS ?? 25000)),
    }),
  });
  return bedrockClient;
};

const extractBedrockText = (payload: BedrockConverseResponse | null | undefined) => {
  const content = payload?.output?.message?.content;
  if (!Array.isArray(content)) return "";
  const textParts = content
    .map((entry) => ("text" in entry && typeof entry.text === "string" ? entry.text : ""))
    .filter(Boolean);
  return textParts.join("\n").trim();
};

const findBedrockToolUse = (payload: unknown, toolName: string) => {
  const queue: unknown[] = [payload];
  const seen = new Set<unknown>();
  while (queue.length) {
    const node = queue.pop();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }

    const candidate = node as BedrockToolUse;
    const nameMatches = !toolName || candidate.name === toolName;
    if (candidate.type === "tool_use" && nameMatches) {
      return candidate;
    }
    if (nameMatches && typeof candidate.name === "string" && ("input" in candidate || "arguments" in candidate)) {
      return candidate;
    }

    queue.push(...Object.values(node as Record<string, unknown>));
  }
  return null;
};

const extractBedrockToolInput = (payload: unknown, toolName: string) => {
  const tool = findBedrockToolUse(payload, toolName);
  if (!tool) return null;
  const input =
    (tool as { input?: unknown }).input ??
    (tool as { arguments?: unknown }).arguments ??
    (tool as { input_json?: unknown }).input_json ??
    null;
  if (typeof input === "string") {
    try {
      return JSON.parse(input) as unknown;
    } catch {
      return null;
    }
  }
  return input ?? null;
};

export const plpSeoBedrockModelId =
  process.env.PLP_SEO_BEDROCK_INFERENCE_PROFILE_ID ??
  process.env.BEDROCK_INFERENCE_PROFILE_ID ??
  process.env.BEDROCK_MODEL_ID ??
  "";

const TOOL_NAME = "plp_seo_page";
const MAX_TOKENS = Math.max(256, Number(process.env.PLP_SEO_BEDROCK_MAX_TOKENS ?? 900));
const TEMPERATURE_RAW = Number(process.env.PLP_SEO_BEDROCK_TEMPERATURE ?? 0.6);
const TEMPERATURE = Number.isFinite(TEMPERATURE_RAW) ? TEMPERATURE_RAW : 0.6;
const TOP_K = Math.max(1, Number(process.env.PLP_SEO_BEDROCK_TOP_K ?? 250));
const TIMEOUT_MS = Math.max(5000, Number(process.env.PLP_SEO_BEDROCK_TIMEOUT_MS ?? 25000));

export const plpSeoToolSchema = {
  name: TOOL_NAME,
  description:
    "Genera SEO para una PLP (page listing) de moda. Devuelve metaTitle, metaDescription y subtitle como JSON.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["metaTitle", "metaDescription", "subtitle"],
    properties: {
      metaTitle: { type: "string" },
      metaDescription: { type: "string" },
      subtitle: { type: "string" },
      keywords: { type: "array", items: { type: "string" } },
    },
  },
} as const;

export async function invokePlpSeoBedrockTool(params: { systemPrompt: string; userText: string }) {
  if (!plpSeoBedrockModelId) {
    throw new Error("PLP SEO Bedrock model is missing (set PLP_SEO_BEDROCK_INFERENCE_PROFILE_ID).");
  }

  const payload = {
    modelId: plpSeoBedrockModelId,
    system: [{ text: params.systemPrompt }],
    messages: [
      {
        role: "user",
        content: [{ text: params.userText }],
      },
    ],
    inferenceConfig: {
      maxTokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    },
    additionalModelRequestFields: {
      top_k: TOP_K,
    },
    toolConfig: {
      tools: [
        {
          toolSpec: {
            name: TOOL_NAME,
            description: plpSeoToolSchema.description,
            inputSchema: { json: plpSeoToolSchema.input_schema as unknown },
          },
        },
      ],
      toolChoice: {
        tool: { name: TOOL_NAME },
      },
    },
  } as unknown as BedrockConverseCommandInput;

  const { ConverseCommand } = await loadBedrockModule();
  const command = new ConverseCommand(payload);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const client = await getBedrockClient();
    const response = (await client.send(command, {
      abortSignal: controller.signal,
    })) as unknown as BedrockConverseResponse;

    const toolInput = extractBedrockToolInput(response.output?.message?.content ?? [], TOOL_NAME);
    const rawText = extractBedrockText(response);
    if (!toolInput && !rawText) throw new Error("Respuesta vacia de Bedrock");
    return { toolInput, rawText, usage: response.usage ?? null };
  } finally {
    clearTimeout(timeout);
  }
}
