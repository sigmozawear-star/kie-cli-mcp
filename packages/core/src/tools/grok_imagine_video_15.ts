import { z } from "zod";
import { GrokImagineVideo15Schema } from "../types.js";
import type { ToolDef, ToolContext, ToolResult } from "./types.js";

export const grokImagineVideo15Tool: ToolDef<typeof GrokImagineVideo15Schema> =
  {
    name: "grok_imagine_video_15",
    description:
      "Generate videos with xAI Grok Imagine Video 1.5 Preview - image-to-video only, 1-7 reference images (one at 1080p), 1-15s duration, 480p/720p/1080p output. Separate model endpoint from grok_imagine",
    category: "video",
    schema: GrokImagineVideo15Schema,
    async run(args, ctx: ToolContext): Promise<ToolResult> {
      try {
        const request = GrokImagineVideo15Schema.parse(args);

        // Use intelligent callback URL fallback
        request.callBackUrl = ctx.getCallbackUrl(request.callBackUrl);

        const response = await ctx.client.generateGrokImagineVideo15(request);

        if (response.code === 200 && response.data?.taskId) {
          await ctx.db.createTask({
            task_id: response.data.taskId,
            api_type: "grok-imagine-video-1-5",
            status: "pending",
          });
        } else {
          throw new Error(
            response.msg ||
              "Failed to create Grok Imagine Video 1.5 Preview task",
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
                  mode: "Grok Imagine Video 1.5 Preview image-to-video",
                  message:
                    "Grok Imagine Video 1.5 Preview video generation task created successfully",
                  parameters: {
                    prompt:
                      request.prompt.substring(0, 100) +
                      (request.prompt.length > 100 ? "..." : ""),
                    image_urls: request.image_urls,
                    aspect_ratio: request.aspect_ratio || "auto",
                    resolution: request.resolution || "480p",
                    duration: request.duration ?? 8,
                    nsfw_checker: request.nsfw_checker,
                    callBackUrl: request.callBackUrl,
                  },
                  next_steps: [
                    `Use get_task_status with task_id: ${response.data?.taskId} to check progress`,
                    "Task completion will be sent to the provided callback URL",
                    'Generated video will be available when status is "completed"',
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
          return ctx.formatError("grok_imagine_video_15", error, {
            prompt: "Required: motion/scene description (max 4096 chars)",
            image_urls:
              "Required: 1-7 reference image URLs (jpeg/png/webp, max 20MB each). Exactly 1 when resolution is 1080p",
            aspect_ratio:
              'Optional: "auto", "1:1", "16:9", "9:16", "3:2", or "2:3" (default: "auto")',
            resolution:
              'Optional: "480p", "720p", or "1080p" (default: "480p")',
            duration: "Optional: duration in seconds 1-15 (default: 8)",
            nsfw_checker:
              "Optional: content filtering toggle (omit to use the API default)",
            callBackUrl:
              "Optional: callback URL (uses KIE_AI_CALLBACK_URL env var if not provided)",
          });
        }

        return ctx.formatError("grok_imagine_video_15", error, {
          prompt: "Required: motion/scene description for the video",
          image_urls: "Required: 1-7 reference image URLs (image-to-video only)",
          resolution: "Optional: output resolution (480p, 720p, 1080p)",
          duration: "Optional: duration in seconds (1-15)",
          callBackUrl: "Optional: URL for task completion notifications",
        });
      }
    },
  };
