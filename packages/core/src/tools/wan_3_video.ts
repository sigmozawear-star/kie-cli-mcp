import { z } from "zod";
import type { ToolDef, ToolContext, ToolResult } from "./types.js";

// Wan 3.0 Video (Kie Market). One model, mode chosen by inputs:
//   text-to-video, first frame, first+last frame, omni reference (images/videos/audio),
//   file-to-video (document), link-to-video (public web page).
// variant "standard" → model "wan/3-0-video"; "prime" → "wan/3-0-video-prime" (high-speed).
// Docs: https://docs.kie.ai/market/wan/3-0-video · https://docs.kie.ai/market/wan/3-0-video-prime

const url = z.string().url();

export const Wan3VideoSchema = z.object({
  variant: z
    .enum(["standard", "prime"])
    .default("standard")
    .describe("standard = wan/3-0-video; prime = wan/3-0-video-prime (high-speed)"),
  prompt: z
    .string()
    .max(20000)
    .optional()
    .describe(
      "Video description, Chinese or English (max 20000 chars). Required for text-to-video. Refer to references as Image1, Video1, Audio1 (array order).",
    ),
  first_frame_url: url.optional().describe("First frame image (JPEG/PNG without transparency/BMP/WEBP, ≤20MB)"),
  last_frame_url: url.optional().describe("Last frame image; requires first_frame_url"),
  reference_image_urls: z.array(url).max(10).optional().describe("Up to 10 reference images → Image1, Image2…"),
  reference_video_urls: z
    .array(url)
    .max(5)
    .optional()
    .describe("Up to 5 reference videos (mp4/mov, 1-15 s each, ≤15 s total) → Video1…; input + output ≤ 30 s; billed"),
  reference_audio_urls: z
    .array(url)
    .max(5)
    .optional()
    .describe("Up to 5 reference audio clips (wav/mp3, 1-15 s each, ≤15 s total) → Audio1…"),
  reference_file_urls: z
    .array(url)
    .max(1)
    .optional()
    .describe("File-to-video: 1 document (pdf/docx/pptx/xlsx/txt/md/key/pages…, ≤100MB, ≤50 pages)"),
  reference_link_urls: z
    .array(url)
    .max(1)
    .optional()
    .describe("Link-to-video: 1 public web page (no login)"),
  resolution: z
    .enum(["480P", "720P", "1080P"])
    .default("720P")
    .describe("480P (8 cr/s), 720P (16 cr/s, default here), 1080P (32 cr/s)"),
  aspect_ratio: z
    .enum(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"])
    .default("adaptive")
    .describe("adaptive picks the ratio from inputs"),
  duration: z
    .number()
    .int()
    .refine((d) => d === -1 || (d >= 2 && d <= 30), "duration must be -1 (smart) or 2-30")
    .default(5)
    .describe("Seconds, 2-30, or -1 to let the model choose (default 5)"),
  audio: z.boolean().default(true).describe("Include an audio track (default true)"),
  seed: z.number().int().min(0).max(2147483647).optional().describe("Optional seed for reproducibility"),
  callBackUrl: url
    .optional()
    .describe("Optional: URL for task completion notifications (uses KIE_AI_CALLBACK_URL env var if not provided)"),
});
export type Wan3VideoRequest = z.infer<typeof Wan3VideoSchema>;

function modeOf(r: Wan3VideoRequest): string {
  const refs =
    (r.reference_image_urls?.length ?? 0) + (r.reference_video_urls?.length ?? 0) + (r.reference_audio_urls?.length ?? 0);
  const hasFrames = !!(r.first_frame_url || r.last_frame_url);
  const hasFile = !!r.reference_file_urls?.length;
  const hasLink = !!r.reference_link_urls?.length;
  if (r.last_frame_url && !r.first_frame_url) throw new Error("last_frame_url requires first_frame_url");
  if (hasFrames && (refs || hasFile || hasLink)) {
    throw new Error("first/last frame cannot be combined with reference_*_urls");
  }
  if (hasFile && hasLink) throw new Error("reference_file_urls and reference_link_urls cannot be used together");
  if ((hasFile || hasLink) && refs) throw new Error("file/link input cannot be combined with reference media");
  if (!r.prompt?.trim() && !hasFrames && !refs && !hasFile && !hasLink) {
    throw new Error("prompt is required for text-to-video");
  }
  if (hasFile) return "file-to-video";
  if (hasLink) return "link-to-video";
  if (refs) return "reference-to-video";
  if (r.last_frame_url) return "first-last-frame-to-video";
  if (r.first_frame_url) return "first-frame-to-video";
  return "text-to-video";
}

export const wan3VideoTool: ToolDef<typeof Wan3VideoSchema> = {
  name: "wan_3_video",
  description:
    "Generate videos with Alibaba Wan 3.0 (2-30 s or smart duration, 480P/720P/1080P, optional audio). Mode follows the inputs: text-to-video, first frame, first+last frame, omni reference (up to 10 images, 5 videos, 5 audio clips as Image1/Video1/Audio1), file-to-video (document) or link-to-video (web page). variant=prime uses the high-speed model. Pricing per second (input video + output): 480P 8 cr, 720P 16 cr, 1080P 32 cr.",
  category: "video",
  schema: Wan3VideoSchema,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const r = Wan3VideoSchema.parse(args);
      const mode = modeOf(r);
      const model = r.variant === "prime" ? "wan/3-0-video-prime" : "wan/3-0-video";
      const input: Record<string, unknown> = {
        resolution: r.resolution,
        aspect_ratio: r.aspect_ratio,
        duration: r.duration,
        audio: r.audio,
      };
      if (r.prompt?.trim()) input.prompt = r.prompt;
      for (const k of [
        "first_frame_url",
        "last_frame_url",
        "reference_image_urls",
        "reference_video_urls",
        "reference_audio_urls",
        "reference_file_urls",
        "reference_link_urls",
        "seed",
      ] as const) {
        const v = r[k];
        if (v !== undefined && !(Array.isArray(v) && v.length === 0)) input[k] = v;
      }

      const response = await ctx.client.createMarketTask(model, input, ctx.getCallbackUrl(r.callBackUrl));
      if (response.code !== 200 || !response.data?.taskId) {
        throw new Error(response.msg || "Failed to create Wan 3.0 task");
      }
      await ctx.db.createTask({ task_id: response.data.taskId, api_type: "wan-3.0-video", status: "pending" });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                task_id: response.data.taskId,
                message: `Wan 3.0 ${mode} task created successfully (${model})`,
                parameters: {
                  model,
                  mode,
                  ...input,
                  ...(r.prompt ? { prompt: r.prompt.slice(0, 100) + (r.prompt.length > 100 ? "..." : "") } : {}),
                },
                next_steps: [
                  `Use get_task_status or wait_for_task with task_id: ${response.data.taskId}`,
                  "Video generation usually takes several minutes",
                ],
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return ctx.formatError("wan_3_video", error, {
        variant: "standard (default) or prime (high-speed)",
        prompt: "Required for text-to-video, max 20000 chars; refer to Image1/Video1/Audio1",
        first_frame_url: "first frame image",
        last_frame_url: "last frame image (needs first_frame_url)",
        reference_image_urls: "≤10 images",
        reference_video_urls: "≤5 videos, ≤15 s total",
        reference_audio_urls: "≤5 audio clips, ≤15 s total",
        reference_file_urls: "1 document",
        reference_link_urls: "1 public web page",
        resolution: "480P, 720P (default), 1080P",
        aspect_ratio: "adaptive (default), 16:9, 4:3, 1:1, 3:4, 9:16",
        duration: "2-30 or -1 (smart), default 5",
        audio: "true (default) / false",
      });
    }
  },
};
