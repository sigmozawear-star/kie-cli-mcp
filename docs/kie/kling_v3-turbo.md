# Kling 3.0 Turbo - Kuaishou Video Generation (fast tier)

> **API Docs**: https://docs.kie.ai/market/kling/v3-turbo-image-to-video and https://docs.kie.ai/market/kling/v3-turbo-text-to-video
> **Model IDs**: `kling/v3-turbo-image-to-video`, `kling/v3-turbo-text-to-video`
> **MCP Tool**: `kling_turbo_video`
> **Verified**: 2026-08-05

## Overview

Kling 3.0 Turbo is the faster, cheaper tier of Kling 3.0. It keeps the flexible
3-15 second duration and adds an explicit `resolution` switch (720p/1080p), but
drops the Kling 3.0 extras: no `mode` (std/pro), no `sound`, no `multi_shots` /
`multi_prompt`, and no `kling_elements`.

Unlike Kling 3.0, which is a single model, Turbo is two models. The tool picks
between them from the presence of `image_urls`:

| Input | Model |
|-------|-------|
| `image_urls` provided | `kling/v3-turbo-image-to-video` |
| `image_urls` omitted | `kling/v3-turbo-text-to-video` |

## Endpoint

`POST https://api.kie.ai/api/v1/jobs/createTask`

Poll with `GET /api/v1/jobs/recordInfo?taskId=...` (tool `api_type`: `kling-v3-turbo-video`).

## Parameters

| Parameter | Type | Default | Applies to | Description |
|-----------|------|---------|------------|-------------|
| `prompt` | string | - | both | Video description (max 2500 chars) |
| `image_urls` | string[] | - | image-to-video | Source image URL. `image/jpeg` or `image/png`, max 10MB. The docs describe a single image ("URL of the image to be used for the video") and the tool caps the array at 1 |
| `duration` | string | `"5"` | both | Duration in seconds, `"3"`-`"15"` |
| `resolution` | enum | `"720p"` | both | `720p`, `1080p` |
| `aspect_ratio` | enum | `"16:9"` | text-to-video only | `16:9`, `9:16`, `1:1`. Not part of the image-to-video body, so the client omits it in that mode |
| `callBackUrl` | string (URI) | - | both | Optional completion webhook |

Kie marks `prompt`, `duration` and `resolution` (plus `image_urls` for
image-to-video, `aspect_ratio` for text-to-video) as required in the `input`
object, but supplies defaults for everything except `prompt` and `image_urls`.
The client always sends the full set so the request never relies on server-side
defaults.

## API Request Examples

Image-to-video:

```json
{
  "model": "kling/v3-turbo-image-to-video",
  "input": {
    "prompt": "The camera slowly pushes in as she turns toward the window",
    "image_urls": ["https://your-domain.com/image/source.png"],
    "duration": "5",
    "resolution": "720p"
  },
  "callBackUrl": "https://your-domain.com/api/callback"
}
```

Text-to-video:

```json
{
  "model": "kling/v3-turbo-text-to-video",
  "input": {
    "prompt": "Outdoor terrace of a European villa at golden hour",
    "duration": "5",
    "aspect_ratio": "16:9",
    "resolution": "720p"
  }
}
```

## Response

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_kling_1765187759663"
  }
}
```

Error codes: 401 (unauthorized), 402 (insufficient credits), 404, 422
(validation), 429 (rate limited), 433, 455, 500, 501, 505. The server treats
only `code === 200` with a `taskId` as success.

## Relationship to `kling_video`

`kling_video` remains the Kling 3.0 standard tool (`kling-3.0/video`) with
multi-shot, native audio and elements. `kling_turbo_video` is the separate fast
tier; the two do not share a model ID or a parameter set.
