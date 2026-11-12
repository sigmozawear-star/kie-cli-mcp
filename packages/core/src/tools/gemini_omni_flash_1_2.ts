import { z } from "zod";
import type { ToolDef, ToolContext, ToolResult } from "./types.js";

// Gemini Omni 1.2 Flash (Kie Market), model "google/gemini-omni-flash-1-2".
// Mode follows the inputs: text / reference images / characters, first frame,
// first + last frame, or video edit (video_list).
// Docs: https://docs.kie.ai/market/google/gemini-omni-flash-1-2
// Characters for character_ids are created with gemini_omni (operation "character").

const url = z.string().url();

export const GeminiOmniFlash12Schema = z.object({
  prompt: z.string().min(1).max(20000).describe("Video description (max 20000 characters)"),
  duration: z
    .number()
    .int()
    .min(3)
    .max(15)
    .default(5)
    .describe("Seconds: 3-15 (3-10 with first + last frame). Ignored in video-edit mode (output follows the input video)."),
  aspect_ratio: z
    .enum(["16:9", "9:16", "auto"])
    .default("16:9")
    .describe("16:9 (default), 9:16 or auto (auto = 16:9 without reference images)"),
  resolution: z.enum(["360p", "720p", "1080p", "4k"]).default("720p").describe("360p, 720p (default), 1080p, 4k"),
  seeds: z.number().int().min(10000).max(99999).optional().describe("Optional seed, 10000-99999"),
  image_urls: z
    .array(url)
    .max(6)
    .optional()
    .describe("Up to 6 reference images (subject, scene, style, storyboard). Not combinable with first/last frame."),
  character_ids: z
    .array(z.string().min(1))
    .max(2)
    .optional()
    .describe("Up to 2 character IDs created with gemini_omni operation=character. Not combinable with first/last frame."),
  first_frame_url: url.optional().describe("First frame image"),
  last_frame_url: url.optional().describe("Last frame image; requires first_frame_url, duration 3-10"),
  video_list: z
    .array(url)
    .max(1)
    .optional()
    .describe("Video edit mode: 1 video URL (MP4, ≤15 s). Can combine with image_urls and character_ids, not with frames."),
  callBackUrl: url
    .optional()
    .describe("Optional: URL for task completion notifications (uses KIE_AI_CALLBACK_URL env var if not provided)"),
});
export type GeminiOmniFlash12Request = z.infer<typeof GeminiOmniFlash12Schema>;

function modeOf(r: GeminiOmniFlash12Request): string {
  const frames = !!(r.first_frame_url || r.last_frame_url);
  const video = !!r.video_list?.length;
  if (r.last_frame_url && !r.first_frame_url) throw new Error("last_frame_url requires first_frame_url");
  if (frames && video) throw new Error("video_list cannot be combined with first/last frame");
  if (frames && (r.image_urls?.length || r.character_ids?.length)) {
    throw new Error("image_urls / character_ids cannot be combined with first/last frame");
  }
  if (r.first_frame_url && r.last_frame_url && r.duration > 10) {
    throw new Error("with first + last frame, duration must be 3-10");
  }
  if (video) return "video-edit";
  if (r.last_frame_url) return "first-last-frame";
  if (r.first_frame_url) return "first-frame";
  if (r.image_urls?.length || r.character_ids?.length) return "reference";
  return "text-to-video";
}

export const geminiOmniFlash12Tool: ToolDef<typeof GeminiOmniFlash12Schema> = {
  name: "gemini_omni_flash_1_2",
  description:
    "Generate videos with Google Gemini Omni 1.2 Flash (3-15 s, 360p/720p/1080p/4k, 16:9 or 9:16). Mode follows the inputs: text-to-video, up to 6 reference images and/or 2 Omni characters, first frame, first + last frame, or video edit (video_list with 1 video ≤15 s). Pricing from 4 credits per second (360p).",
  category: "video",
  schema: GeminiOmniFlash12Schema,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const r = GeminiOmniFlash12Schema.parse(args);
      const mode = modeOf(r);
      const input: Record<string, unknown> = {
        prompt: r.prompt,
        aspect_ratio: r.aspect_ratio,
        resolution: r.resolution,
      };
      if (mode !== "video-edit") input.duration = r.duration;
      if (r.seeds !== undefined) input.seeds = r.seeds;
      if (r.image_urls?.length) input.image_urls = r.image_urls;
      if (r.character_ids?.length) input.character_ids = r.character_ids;
      if (r.first_frame_url) input.first_frame_url = r.first_frame_url;
      if (r.last_frame_url) input.last_frame_url = r.last_frame_url;
      if (r.video_list?.length) input.video_list = r.video_list;

      const model = "google/gemini-omni-flash-1-2";
      const response = await ctx.client.createMarketTask(model, input, ctx.getCallbackUrl(r.callBackUrl));
      if (response.code !== 200 || !response.data?.taskId) {
        throw new Error(response.msg || "Failed to create Gemini Omni 1.2 Flash task");
      }
      await ctx.db.createTask({ task_id: response.data.taskId, api_type: "gemini-omni-flash-1-2", status: "pending" });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                task_id: response.data.taskId,
                message: `Gemini Omni 1.2 Flash ${mode} task created successfully`,
                parameters: { model, mode, ...input, prompt: r.prompt.slice(0, 100) + (r.prompt.length > 100 ? "..." : "") },
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
      return ctx.formatError("gemini_omni_flash_1_2", error, {
        prompt: "Required, max 20000 chars",
        duration: "3-15 s (3-10 with first + last frame), default 5; not used with video_list",
        aspect_ratio: "16:9 (default), 9:16, auto",
        resolution: "360p, 720p (default), 1080p, 4k",
        seeds: "Optional, 10000-99999",
        image_urls: "≤6 reference images (not with frames)",
        character_ids: "≤2 IDs from gemini_omni operation=character (not with frames)",
        first_frame_url: "first frame image",
        last_frame_url: "last frame image (needs first_frame_url)",
        video_list: "video edit: 1 video URL ≤15 s (not with frames)",
      });
    }
  },
};
