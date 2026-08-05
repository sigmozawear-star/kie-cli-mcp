# Grok Imagine Video 1.5 Preview - xAI Image-to-Video

> **API Docs**: https://docs.kie.ai/market/grok-imagine/1-5-preview
> **Model ID**: `grok-imagine-video-1-5-preview`
> **MCP Tool**: `grok_imagine_video_15`
> **Verified**: 2026-08-05

## Overview

xAI's Grok Imagine Video 1.5 Preview turns reference images into short video
with generated motion and audio. It sits on its own model ID, not under the
`grok-imagine/*` family that the existing `grok_imagine` tool wraps, and it
takes a different parameter set (`nsfw_checker`, 1-7 reference images, integer
`duration`, `auto` aspect ratio).

## Endpoint

`POST https://api.kie.ai/api/v1/jobs/createTask`

Poll with `GET /api/v1/jobs/recordInfo?taskId=...` (tool `api_type`: `grok-imagine-video-1-5`).

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | string | - | Motion/scene description, max 4096 chars |
| `image_urls` | string[] | - | Reference images. `image/jpeg`, `image/png`, `image/webp`, `image/jpg`, max 20MB each, up to 7. Only one is supported when `resolution` is `1080p` |
| `aspect_ratio` | enum | `auto` | `auto`, `1:1`, `16:9`, `9:16`, `3:2`, `2:3`. The API ignores it when a single image is supplied |
| `resolution` | enum | `480p` | `480p`, `720p`, `1080p` |
| `duration` | integer | `8` | Seconds, range `[1, 15]` |
| `nsfw_checker` | boolean | `false` (API) | Content filtering toggle. "Disables content filtering if false; results returned directly by model" |
| `callBackUrl` | string (URI) | - | Optional completion webhook |

### Schema decisions worth knowing

- **`image_urls` is required by the tool, optional in the API schema.** Kie's
  OpenAPI marks only the `input` object itself as required, but this model is
  published as an image-to-video model and the playground always sends an
  image. The tool requires 1-7 URLs so a missing image fails fast with a clear
  message instead of an opaque provider error.
- **`nsfw_checker` is never defaulted client-side.** The playground shows it on,
  the API documents `false`. Because the two disagree and the flag controls
  content filtering, the tool sends the key only when the caller sets it
  explicitly, letting the API's own default stand otherwise.
- **1080p is validated locally.** The schema rejects more than one image when
  `resolution` is `1080p`, matching the documented constraint.

## API Request Example

```json
{
  "model": "grok-imagine-video-1-5-preview",
  "input": {
    "prompt": "Describe the scene you want to generate.",
    "image_urls": ["https://your-domain.com/image/example.png"],
    "aspect_ratio": "16:9",
    "resolution": "480p",
    "duration": 8
  },
  "callBackUrl": "https://your-domain.com/api/callback"
}
```

## Response

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_grok-imagine-video-1.5-preview_1234567890",
    "recordId": "string"
  }
}
```

Error codes: 401 (unauthorized), 402 (insufficient credits), 404, 422
(validation), 429 (rate limited), 455, 500, 501 (generation failed), 505. The
server treats only `code === 200` with a `taskId` as success.

## Relationship to `grok_imagine`

`grok_imagine` wraps the general Grok Imagine endpoints
(`grok-imagine/text-to-image`, `/text-to-video`, `/image-to-video`, `/upscale`).
`grok_imagine_video_15` is a distinct model endpoint with its own body shape and
is not reachable through that tool.
