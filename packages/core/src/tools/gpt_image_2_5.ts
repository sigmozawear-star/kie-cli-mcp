import { z } from "zod";
import { GptImage25Schema } from "../types.js";
import type { ToolDef, ToolContext, ToolResult } from "./types.js";

export const gptImage25Tool: ToolDef<typeof GptImage25Schema> = {
  name: "gpt_image_2_5",
  description:
    "Generate images using GPT Image 2.5 Sunburst (text-to-image and image-to-image with up to 16 reference images). Precision-oriented model for detailed work where small edits must preserve the rest of the composition.",
  category: "image",
  schema: GptImage25Schema,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const request = GptImage25Schema.parse(args);
      request.callBackUrl = ctx.getCallbackUrl(request.callBackUrl);

      const response = await ctx.client.generateGptImage25(request);

      if (response.code === 200 && response.data?.taskId) {
        const mode = request.input_urls?.length
          ? "Image-to-Image"
          : "Text-to-Image";

        await ctx.db.createTask({
          task_id: response.data.taskId,
          api_type: "gpt-image-2-5",
          status: "pending",
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  task_id: response.data.taskId,
                  message: `GPT Image 2.5 Sunburst ${mode} task created successfully`,
                  parameters: {
                    mode,
                    prompt:
                      request.prompt.substring(0, 100) +
                      (request.prompt.length > 100 ? "..." : ""),
                    aspect_ratio: request.aspect_ratio || "auto",
                    resolution: request.resolution || "1K",
                    ...(request.input_urls && {
                      input_urls: request.input_urls,
                    }),
                  },
                  next_steps: [
                    `Use get_task_status with task_id: ${response.data.taskId} to check progress`,
                    'Generated images will be available when status is "completed"',
                  ],
                },
                null,
                2,
              ),
            },
          ],
        };
      } else {
        throw new Error(response.msg || "Failed to create GPT Image 2.5 task");
      }
    } catch (error) {
      const hints = {
        prompt:
          "Required: Text prompt describing the desired image (max 30000 chars)",
        input_urls:
          "Optional: Array of up to 16 image URLs for image-to-image mode",
        aspect_ratio:
          "Optional: auto, 1:1, 9:16, 16:9, 4:3, 3:4 (default: auto)",
        resolution: "Optional: 1K, 2K, 4K (default: 1K)",
      };
      if (error instanceof z.ZodError) {
        return ctx.formatError("gpt_image_2_5", error, hints);
      }
      return ctx.formatError("gpt_image_2_5", error, hints);
    }
  },
};
