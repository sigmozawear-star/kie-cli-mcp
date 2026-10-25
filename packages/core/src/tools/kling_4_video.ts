import { z } from "zod";
import type { ToolDef, ToolContext, ToolResult } from "./types.js";

// Kling 4.0 (Kie Market): two endpoints behind one tool.
//   mode "reference" → model "kling-4.0/reference-to-video" (text / image / video /
//                      element / voice references; no references = text-to-video)
//   mode "keyframe"  → model "kling-4.0/keyframe-to-video" (first / middle / last frames)
// Docs: https://docs.kie.ai/market/kling/v4-reference-to-video
//       https://docs.kie.ai/market/kling/v4-keyframe-to-video

const url = z.string().url();
const refName = z
  .string()
  .regex(/^[一-龥A-Za-z0-9_]{1,20}$/, "1-20 letters, digits, underscores or Chinese characters")
  .describe("Reference name used in the prompt as @name (unique, not image_N/video_N/first_frame/last_frame)");

export const Kling4VideoSchema = z.object({
  mode: z
    .enum(["reference", "keyframe"])
    .default("reference")
    .describe(
      "reference = text/image/video/element/voice references (omit all references for pure text-to-video); keyframe = first frame + up to 8 keyframes + last frame",
    ),
  prompt: z
    .string()
    .min(1)
    .max(8000)
    .describe(
      "Video description (max 8000 chars). Reference mode: mention @image_1, @video_1 or custom @name. Keyframe mode: mention @first_frame, @keyframe_1…, @last_frame.",
    ),
  duration: z.number().int().min(3).max(30).default(5).describe("Seconds, 3-30 (default 5)"),
  resolution: z.enum(["720p", "1080p"]).default("720p").describe("Output resolution (default 720p)"),
  aspect_ratio: z
    .enum(["auto", "16:9", "9:16", "1:1", "21:9"])
    .optional()
    .describe(
      "Optional. Reference mode: auto when references are given, else 16:9. Keyframe mode: only used without frames (output follows the first frame otherwise).",
    ),
  // reference mode
  image_urls: z.array(url).max(10).optional().describe("Reference mode: up to 10 reference images (@image_1, @image_2…)"),
  video_urls: z
    .array(url)
    .max(5)
    .optional()
    .describe("Reference mode: up to 5 reference videos, 2-30 s each (@video_1…). Billed as extra seconds."),
  keep_original_sound: z
    .boolean()
    .optional()
    .describe("Reference mode: keep the audio of video_urls (default false). Without video_urls native audio is generated."),
  elements: z
    .array(
      z.object({
        name: refName,
        image_urls: z.array(url).min(2).max(4).optional().describe("2-4 images of the subject, first = primary view"),
        video_url: url.optional().describe("OR one single-shot character video, 3-8 s, shortest side ≥ 700 px"),
        tag: z.enum(["character", "animal", "prop", "costume", "scene", "effect", "others"]).optional(),
        description: z.string().max(100).optional(),
        voice_url: url.optional().describe("Optional audio bound to this element"),
      }),
    )
    .max(7)
    .optional()
    .describe("Reference mode: up to 7 named subjects (@name)"),
  voices: z
    .array(z.object({ name: refName, audio_url: url }))
    .max(3)
    .optional()
    .describe("Reference mode: up to 3 named voice references (@name)"),
  // keyframe mode
  first_frame_url: url.optional().describe("Keyframe mode: first frame image (@first_frame)"),
  keyframe_urls: z
    .array(url)
    .max(8)
    .optional()
    .describe("Keyframe mode: up to 8 middle frames in order (@keyframe_1…). Total frames ≤ duration+1 (max 10)."),
  last_frame_url: url.optional().describe("Keyframe mode: last frame image (@last_frame)"),
  callBackUrl: url
    .optional()
    .describe("Optional: URL for task completion notifications (uses KIE_AI_CALLBACK_URL env var if not provided)"),
});
export type Kling4VideoRequest = z.infer<typeof Kling4VideoSchema>;

function validate(r: Kling4VideoRequest): void {
  const refFields = [
    r.image_urls?.length && "image_urls",
    r.video_urls?.length && "video_urls",
    r.elements?.length && "elements",
    r.voices?.length && "voices",
    r.keep_original_sound !== undefined && "keep_original_sound",
  ].filter(Boolean);
  const frameFields = [
    r.first_frame_url && "first_frame_url",
    r.keyframe_urls?.length && "keyframe_urls",
    r.last_frame_url && "last_frame_url",
  ].filter(Boolean);
  if (r.mode === "reference" && frameFields.length) {
    throw new Error(`${frameFields.join(", ")} require mode "keyframe"`);
  }
  if (r.mode === "keyframe") {
    if (refFields.length) throw new Error(`${refFields.join(", ")} require mode "reference"`);
    const frames = (r.first_frame_url ? 1 : 0) + (r.keyframe_urls?.length ?? 0) + (r.last_frame_url ? 1 : 0);
    const cap = Math.min(10, r.duration + 1);
    if (frames > cap) throw new Error(`Too many frames (${frames}) for ${r.duration}s; max ${cap}`);
  }
  for (const e of r.elements ?? []) {
    if (!!e.image_urls === !!e.video_url) {
      throw new Error(`element "${e.name}" needs exactly one of image_urls (2-4) or video_url`);
    }
    if (e.video_url && e.tag && e.tag !== "character") {
      throw new Error(`video element "${e.name}" must use tag "character"`);
    }
  }
  const names = [...(r.elements ?? []), ...(r.voices ?? [])].map((x) => x.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new Error("element/voice names must be unique");
  const videoCount = (r.video_urls?.length ?? 0) + (r.elements ?? []).filter((e) => e.video_url).length;
  if (videoCount > 5) throw new Error("video_urls + video elements must be ≤ 5");
  const total =
    (r.image_urls?.length ?? 0) + (r.video_urls?.length ?? 0) + (r.elements?.length ?? 0) + (r.voices?.length ?? 0);
  if (total > 15) throw new Error("image_urls + video_urls + elements + voices must be ≤ 15");
}

export const kling4VideoTool: ToolDef<typeof Kling4VideoSchema> = {
  name: "kling_4_video",
  description:
    "Generate videos with Kling 4.0 (3-30 s, 720p/1080p, native stereo audio). mode=reference: text-to-video or omni reference with up to 10 images, 5 videos, 7 named elements and 3 voices (@image_1, @video_1, @name in the prompt). mode=keyframe: first frame + up to 8 keyframes + last frame (@first_frame, @keyframe_1, @last_frame). Pricing per second: 720p 28.5 cr (17 with video input), 1080p 42.5 cr (25.5 with video input).",
  category: "video",
  schema: Kling4VideoSchema,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const r = Kling4VideoSchema.parse(args);
      validate(r);
      const model = r.mode === "keyframe" ? "kling-4.0/keyframe-to-video" : "kling-4.0/reference-to-video";
      const input: Record<string, unknown> = {
        prompt: r.prompt,
        duration: r.duration,
        resolution: r.resolution,
      };
      if (r.aspect_ratio) input.aspect_ratio = r.aspect_ratio;
      if (r.mode === "reference") {
        if (r.image_urls?.length) input.image_urls = r.image_urls;
        if (r.video_urls?.length) input.video_urls = r.video_urls;
        if (r.keep_original_sound !== undefined) input.keep_original_sound = r.keep_original_sound;
        if (r.elements?.length) input.elements = r.elements;
        if (r.voices?.length) input.voices = r.voices;
      } else {
        if (r.first_frame_url) input.first_frame_url = r.first_frame_url;
        if (r.keyframe_urls?.length) input.keyframe_urls = r.keyframe_urls;
        if (r.last_frame_url) input.last_frame_url = r.last_frame_url;
      }

      const response = await ctx.client.createMarketTask(model, input, ctx.getCallbackUrl(r.callBackUrl));
      if (response.code !== 200 || !response.data?.taskId) {
        throw new Error(response.msg || "Failed to create Kling 4.0 task");
      }
      await ctx.db.createTask({ task_id: response.data.taskId, api_type: "kling-4.0-video", status: "pending" });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                task_id: response.data.taskId,
                message: `Kling 4.0 ${r.mode} task created successfully`,
                parameters: { model, ...input, prompt: r.prompt.slice(0, 100) + (r.prompt.length > 100 ? "..." : "") },
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
      return ctx.formatError("kling_4_video", error, {
        mode: "reference (default) or keyframe",
        prompt: "Required, max 8000 chars; reference media as @image_1 / @video_1 / @name or @first_frame / @keyframe_1 / @last_frame",
        duration: "3-30 seconds (default 5)",
        resolution: "720p (default) or 1080p",
        aspect_ratio: "auto, 16:9, 9:16, 1:1, 21:9",
        image_urls: "reference mode: ≤10 image URLs",
        video_urls: "reference mode: ≤5 video URLs, 2-30 s each",
        elements: "reference mode: ≤7 {name, image_urls(2-4) | video_url, tag?, description?, voice_url?}",
        voices: "reference mode: ≤3 {name, audio_url}",
        first_frame_url: "keyframe mode: first frame",
        keyframe_urls: "keyframe mode: ≤8 middle frames",
        last_frame_url: "keyframe mode: last frame",
      });
    }
  },
};
