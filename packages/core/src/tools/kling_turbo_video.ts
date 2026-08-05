import { z } from "zod";
import { KlingTurboVideoSchema } from "../types.js";
import type { ToolDef, ToolContext, ToolResult } from "./types.js";

export const klingTurboVideoTool: ToolDef<typeof KlingTurboVideoSchema> = {
  name: "kling_turbo_video",
  description:
    "Generate videos using Kling 3.0 Turbo, the faster and cheaper Kling tier - image-to-video when image_urls is provided, otherwise text-to-video. Supports 3-15s duration and 720p/1080p output",
  category: "video",
  schema: KlingTurboVideoSchema,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const request = KlingTurboVideoSchema.parse(args);

      // Use intelligent callback URL fallback
      request.callBackUrl = ctx.getCallbackUrl(request.callBackUrl);

      const response = await ctx.client.generateKlingTurboVideo(request);

      const hasImages = !!request.image_urls && request.image_urls.length > 0;
      const modeDescription = hasImages
        ? "Kling 3.0 Turbo image-to-video"
        : "Kling 3.0 Turbo text-to-video";

      if (response.code === 200 && response.data?.taskId) {
        await ctx.db.createTask({
          task_id: response.data.taskId,
          api_type: "kling-v3-turbo-video",
          status: "pending",
        });
      } else {
        throw new Error(
          response.msg || "Failed to create Kling 3.0 Turbo video task",
        );
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                task_id: response.data?.taskId,
                mode: modeDescription,
                message: `Kling 3.0 Turbo video generation task created successfully (${modeDescription})`,
                parameters: {
                  prompt: request.prompt,
                  duration: request.duration || "5",
                  resolution: request.resolution || "720p",
                  // aspect_ratio only applies to the text-to-video model
                  aspect_ratio: hasImages
                    ? undefined
                    : request.aspect_ratio || "16:9",
                  image_urls: hasImages ? request.image_urls : undefined,
                  callBackUrl: request.callBackUrl,
                },
                next_steps: [
                  "Use get_task_status to check generation progress",
                  "Task completion will be sent to the provided callback URL",
                  "Turbo generation is faster than Kling 3.0 standard, typically a few minutes",
                ],
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return ctx.formatError("kling_turbo_video", error, {
          prompt: "Required: video description (max 2500 chars)",
          image_urls:
            "Optional: single source image URL (jpeg/png, max 10MB) for image-to-video. Omit for text-to-video",
          duration: 'Optional: video duration "3"-"15" (default: "5")',
          resolution: 'Optional: "720p" or "1080p" (default: "720p")',
          aspect_ratio:
            'Optional: "16:9", "9:16", or "1:1" (default: "16:9", text-to-video only)',
          callBackUrl:
            "Optional: callback URL (uses KIE_AI_CALLBACK_URL env var if not provided)",
        });
      }

      return ctx.formatError("kling_turbo_video", error, {
        prompt: "Required: text description for video generation",
        image_urls: "Optional: source image URL for image-to-video",
        duration: "Optional: video duration 3-15 seconds",
        resolution: "Optional: output resolution (720p or 1080p)",
        aspect_ratio: "Optional: aspect ratio (16:9, 9:16, 1:1)",
        callBackUrl: "Optional: URL for task completion notifications",
      });
    }
  },
};
