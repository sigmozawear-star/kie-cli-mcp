import { z } from "zod";
import type { ToolDef, ToolContext, ToolResult } from "./types.js";

// GPT Image 2.6 (Kie Market). Model id: "gpt-image-2-6/<variant>-<mode>"
//   variant: sunburst (detail/consistency, 1K-4K) | economy (cost-efficient, 1K only)
//   mode:    text-to-image (no input_urls) | image-to-image (with input_urls)
// Docs: https://docs.kie.ai/market/gpt/gpt-image-2-6-sunburst-text-to-image (and siblings)

const SUNBURST_RATIOS = [
  "auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5",
  "16:9", "9:16", "2:1", "1:2", "21:9", "9:21", "3:1", "1:3",
] as const;
const ECONOMY_RATIOS = ["auto", "1:1", "16:9", "9:16", "3:2", "2:3", "21:9", "4:3"];

export const GptImage26Schema = z.object({
  variant: z
    .enum(["sunburst", "economy"])
    .default("sunburst")
    .describe("sunburst = highest detail, 1K/2K/4K (default); economy = cheaper, 1K only, fewer ratios/formats"),
  prompt: z.string().min(1).max(20000).describe("Text prompt (max 20000 characters)"),
  input_urls: z
    .array(z.string().url())
    .max(16)
    .optional()
    .describe("Up to 16 reference image URLs → image-to-image. Omit for text-to-image."),
  aspect_ratio: z
    .enum(SUNBURST_RATIOS)
    .default("auto")
    .describe("auto (default) or a ratio. Economy supports only auto, 1:1, 16:9, 9:16, 3:2, 2:3, 21:9, 4:3."),
  resolution: z
    .enum(["1K", "2K", "4K"])
    .default("1K")
    .describe("Sunburst: 1K (default), 2K, 4K. Economy is always 1K."),
  background: z
    .enum(["transparent", "opaque", "auto"])
    .optional()
    .describe("transparent / opaque / auto. Only at 1K (omit for 2K/4K)."),
  output_format: z
    .enum(["png", "jpeg", "webp", "gif"])
    .optional()
    .describe("png (default). Sunburst: png/jpeg/webp, gif only for text-to-image. Economy: png, gif only for text-to-image."),
  frame_count: z
    .enum(["auto", "4", "9", "16", "25", "36", "64"])
    .optional()
    .describe("GIF only (text-to-image): number of animation frames, auto by default"),
  frame_duration_ms: z
    .number()
    .int()
    .min(20)
    .max(2000)
    .optional()
    .describe("GIF only (text-to-image): ms per frame, 20-2000, rounded to 10 ms"),
  callBackUrl: z
    .string()
    .url()
    .optional()
    .describe("Optional: URL for task completion notifications (uses KIE_AI_CALLBACK_URL env var if not provided)"),
});
export type GptImage26Request = z.infer<typeof GptImage26Schema>;

function buildInput(r: GptImage26Request, i2i: boolean): Record<string, unknown> {
  const economy = r.variant === "economy";
  if (economy && r.resolution !== "1K") throw new Error("economy supports only resolution 1K");
  if (economy && !ECONOMY_RATIOS.includes(r.aspect_ratio)) {
    throw new Error(`economy aspect_ratio must be one of: ${ECONOMY_RATIOS.join(", ")}`);
  }
  const formats = economy ? (i2i ? ["png"] : ["png", "gif"]) : i2i ? ["png", "jpeg", "webp"] : ["png", "jpeg", "webp", "gif"];
  if (r.output_format && !formats.includes(r.output_format)) {
    throw new Error(`output_format for ${r.variant} ${i2i ? "image-to-image" : "text-to-image"} must be: ${formats.join(", ")}`);
  }
  const gif = r.output_format === "gif";
  if (!gif && (r.frame_count || r.frame_duration_ms)) {
    throw new Error("frame_count / frame_duration_ms require output_format gif");
  }
  if (r.background && r.resolution !== "1K") throw new Error("background only applies at resolution 1K");

  const input: Record<string, unknown> = { prompt: r.prompt, aspect_ratio: r.aspect_ratio };
  if (i2i) input.input_urls = r.input_urls;
  if (!economy) input.resolution = r.resolution;
  if (r.background) input.background = r.background;
  if (r.output_format) input.output_format = r.output_format;
  if (r.frame_count) input.frame_count = r.frame_count;
  if (r.frame_duration_ms) input.frame_duration_ms = r.frame_duration_ms;
  return input;
}

export const gptImage26Tool: ToolDef<typeof GptImage26Schema> = {
  name: "gpt_image_2_6",
  description:
    "Generate images with OpenAI GPT Image 2.6 on Kie: text-to-image, or image-to-image with up to 16 reference images. variant=sunburst (default, highest detail, 1K/2K/4K, 16 aspect ratios, transparent background at 1K, animated GIF for text-to-image) or variant=economy (cheaper, 1K only).",
  category: "image",
  schema: GptImage26Schema,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const r = GptImage26Schema.parse(args);
      const i2i = !!r.input_urls?.length;
      const mode = i2i ? "image-to-image" : "text-to-image";
      const model = `gpt-image-2-6/${r.variant}-${mode}`;
      const input = buildInput(r, i2i);

      const response = await ctx.client.createMarketTask(model, input, ctx.getCallbackUrl(r.callBackUrl));
      if (response.code !== 200 || !response.data?.taskId) {
        throw new Error(response.msg || "Failed to create GPT Image 2.6 task");
      }
      await ctx.db.createTask({ task_id: response.data.taskId, api_type: "gpt-image-2-6", status: "pending" });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                task_id: response.data.taskId,
                message: `GPT Image 2.6 ${r.variant} ${mode} task created successfully`,
                parameters: {
                  model,
                  ...input,
                  prompt: r.prompt.slice(0, 100) + (r.prompt.length > 100 ? "..." : ""),
                },
                next_steps: [
                  `Use get_task_status or wait_for_task with task_id: ${response.data.taskId}`,
                  'Generated images will be available when status is "completed"',
                ],
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return ctx.formatError("gpt_image_2_6", error, {
        variant: "sunburst (default) or economy",
        prompt: "Required, max 20000 chars",
        input_urls: "Optional: up to 16 image URLs for image-to-image",
        aspect_ratio: "auto (default), 1:1, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 16:9, 9:16, 2:1, 1:2, 21:9, 9:21, 3:1, 1:3 (economy: subset)",
        resolution: "1K (default), 2K, 4K (economy: 1K only)",
        background: "transparent / opaque / auto, only at 1K",
        output_format: "png (default), jpeg, webp, gif (gif: text-to-image only)",
        frame_count: "gif only: auto, 4, 9, 16, 25, 36, 64",
        frame_duration_ms: "gif only: 20-2000",
      });
    }
  },
};
