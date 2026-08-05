import { jest } from "@jest/globals";
import { KlingTurboVideoSchema, GrokImagineVideo15Schema } from "../types.js";
import { KieAiClient } from "../kie-ai-client.js";

// ──────────────────────────────────────────────
// Kling 3.0 Turbo (kling/v3-turbo-{image,text}-to-video)
// ──────────────────────────────────────────────

describe("KlingTurboVideoSchema", () => {
  const image = "https://example.com/frame.png";

  it("accepts image-to-video (prompt + one image)", () => {
    const result = KlingTurboVideoSchema.safeParse({
      prompt: "A hero walks through fire",
      image_urls: [image],
      duration: "8",
      resolution: "1080p",
    });
    expect(result.success).toBe(true);
  });

  it("accepts text-to-video (prompt only)", () => {
    const result = KlingTurboVideoSchema.safeParse({
      prompt: "A drone shot over a canyon",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // `.default(x).optional()` documents the default in the JSON Schema but
      // leaves omitted keys undefined, so the client applies the fallback.
      expect(result.data.duration).toBeUndefined();
      expect(result.data.resolution).toBeUndefined();
      expect(result.data.aspect_ratio).toBeUndefined();
      expect(result.data.image_urls).toBeUndefined();
    }
  });

  it("requires a prompt", () => {
    expect(KlingTurboVideoSchema.safeParse({}).success).toBe(false);
    expect(
      KlingTurboVideoSchema.safeParse({ prompt: "" }).success,
    ).toBe(false);
  });

  it("rejects a prompt over 2500 characters", () => {
    expect(
      KlingTurboVideoSchema.safeParse({ prompt: "x".repeat(2501) }).success,
    ).toBe(false);
    expect(
      KlingTurboVideoSchema.safeParse({ prompt: "x".repeat(2500) }).success,
    ).toBe(true);
  });

  it("rejects durations outside 3-15 seconds", () => {
    for (const duration of ["2", "16", "abc"]) {
      expect(
        KlingTurboVideoSchema.safeParse({ prompt: "test", duration }).success,
      ).toBe(false);
    }
    for (const duration of ["3", "15"]) {
      expect(
        KlingTurboVideoSchema.safeParse({ prompt: "test", duration }).success,
      ).toBe(true);
    }
  });

  it("accepts only 720p and 1080p", () => {
    expect(
      KlingTurboVideoSchema.safeParse({ prompt: "test", resolution: "480p" })
        .success,
    ).toBe(false);
  });

  it("rejects more than one source image and non-URL entries", () => {
    expect(
      KlingTurboVideoSchema.safeParse({
        prompt: "test",
        image_urls: [image, "https://example.com/second.png"],
      }).success,
    ).toBe(false);
    expect(
      KlingTurboVideoSchema.safeParse({ prompt: "test", image_urls: [] })
        .success,
    ).toBe(false);
    expect(
      KlingTurboVideoSchema.safeParse({ prompt: "test", image_urls: ["nope"] })
        .success,
    ).toBe(false);
  });
});

// ──────────────────────────────────────────────
// Grok Imagine Video 1.5 Preview (grok-imagine-video-1-5-preview)
// ──────────────────────────────────────────────

describe("GrokImagineVideo15Schema", () => {
  const image = "https://example.com/source.png";
  const base = { prompt: "Make the subject turn and smile", image_urls: [image] };

  it("accepts prompt + image, leaving omitted options to the client fallback", () => {
    const result = GrokImagineVideo15Schema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.image_urls).toEqual([image]);
      // `.default(x).optional()` documents the default in the JSON Schema but
      // leaves omitted keys undefined, so the client applies the fallback.
      expect(result.data.aspect_ratio).toBeUndefined();
      expect(result.data.resolution).toBeUndefined();
      expect(result.data.duration).toBeUndefined();
      // Never defaulted: omitted means "use the API's own default".
      expect(result.data.nsfw_checker).toBeUndefined();
    }
  });

  it("requires both prompt and at least one image (image-to-video only)", () => {
    expect(
      GrokImagineVideo15Schema.safeParse({ image_urls: [image] }).success,
    ).toBe(false);
    expect(
      GrokImagineVideo15Schema.safeParse({ prompt: "no image" }).success,
    ).toBe(false);
    expect(
      GrokImagineVideo15Schema.safeParse({ ...base, image_urls: [] }).success,
    ).toBe(false);
  });

  it("rejects a prompt over 4096 characters", () => {
    expect(
      GrokImagineVideo15Schema.safeParse({ ...base, prompt: "x".repeat(4097) })
        .success,
    ).toBe(false);
  });

  it("allows up to 7 reference images and rejects 8", () => {
    const urls = (n: number) =>
      Array.from({ length: n }, (_, i) => `https://example.com/ref-${i}.png`);
    expect(
      GrokImagineVideo15Schema.safeParse({ ...base, image_urls: urls(7) })
        .success,
    ).toBe(true);
    expect(
      GrokImagineVideo15Schema.safeParse({ ...base, image_urls: urls(8) })
        .success,
    ).toBe(false);
  });

  it("limits 1080p to a single image", () => {
    const urls = ["https://example.com/a.png", "https://example.com/b.png"];
    expect(
      GrokImagineVideo15Schema.safeParse({
        ...base,
        image_urls: urls,
        resolution: "1080p",
      }).success,
    ).toBe(false);
    expect(
      GrokImagineVideo15Schema.safeParse({ ...base, resolution: "1080p" })
        .success,
    ).toBe(true);
    // Multiple images are fine below 1080p.
    expect(
      GrokImagineVideo15Schema.safeParse({
        ...base,
        image_urls: urls,
        resolution: "720p",
      }).success,
    ).toBe(true);
  });

  it("enforces the 1-15 second integer duration range", () => {
    for (const duration of [0, 16, 8.5]) {
      expect(
        GrokImagineVideo15Schema.safeParse({ ...base, duration }).success,
      ).toBe(false);
    }
    for (const duration of [1, 15]) {
      expect(
        GrokImagineVideo15Schema.safeParse({ ...base, duration }).success,
      ).toBe(true);
    }
  });

  it("accepts every documented aspect ratio and resolution", () => {
    for (const aspect_ratio of ["auto", "1:1", "16:9", "9:16", "3:2", "2:3"]) {
      expect(
        GrokImagineVideo15Schema.safeParse({ ...base, aspect_ratio }).success,
      ).toBe(true);
    }
    for (const resolution of ["480p", "720p"]) {
      expect(
        GrokImagineVideo15Schema.safeParse({ ...base, resolution }).success,
      ).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────
// Request payloads (model routing + input mapping)
// ──────────────────────────────────────────────

describe("createTask payloads for the new video models", () => {
  const config = {
    apiKey: "test-key",
    baseUrl: "https://provider.example/api/v1",
    timeout: 1_000,
    callbackUrlFallback: "",
  };

  const mockCreateTask = () =>
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: 200, data: { taskId: "task-1" } }), {
        headers: { "content-type": "application/json" },
      }),
    );

  const sentBody = (fetchMock: ReturnType<typeof mockCreateTask>) =>
    JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      model: string;
      input: Record<string, unknown>;
    };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Kling turbo picks the image-to-video model and omits aspect_ratio", async () => {
    const fetchMock = mockCreateTask();

    await new KieAiClient(config).generateKlingTurboVideo({
      prompt: "animate this",
      image_urls: ["https://example.com/source.png"],
      resolution: "1080p",
      aspect_ratio: "9:16",
    });

    const body = sentBody(fetchMock);
    expect(body.model).toBe("kling/v3-turbo-image-to-video");
    expect(body.input).toEqual({
      prompt: "animate this",
      duration: "5",
      resolution: "1080p",
      image_urls: ["https://example.com/source.png"],
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/jobs/createTask");
  });

  test("Kling turbo falls back to the text-to-video model with aspect_ratio", async () => {
    const fetchMock = mockCreateTask();

    await new KieAiClient(config).generateKlingTurboVideo({
      prompt: "a canyon flyover",
      duration: "12",
    });

    const body = sentBody(fetchMock);
    expect(body.model).toBe("kling/v3-turbo-text-to-video");
    expect(body.input).toEqual({
      prompt: "a canyon flyover",
      duration: "12",
      resolution: "720p",
      aspect_ratio: "16:9",
    });
    expect(body.input).not.toHaveProperty("image_urls");
  });

  test("Grok 1.5 sends the preview model id and defaults duration/resolution", async () => {
    const fetchMock = mockCreateTask();

    await new KieAiClient(config).generateGrokImagineVideo15({
      prompt: "turn and smile",
      image_urls: ["https://example.com/a.png"],
    });

    const body = sentBody(fetchMock);
    expect(body.model).toBe("grok-imagine-video-1-5-preview");
    expect(body.input).toEqual({
      prompt: "turn and smile",
      image_urls: ["https://example.com/a.png"],
      aspect_ratio: "auto",
      resolution: "480p",
      duration: 8,
    });
    // Omitted so the API's own content-filter default applies.
    expect(body.input).not.toHaveProperty("nsfw_checker");
  });

  test("Grok 1.5 forwards nsfw_checker only when explicitly set", async () => {
    const fetchMock = mockCreateTask();

    await new KieAiClient(config).generateGrokImagineVideo15({
      prompt: "turn and smile",
      image_urls: ["https://example.com/a.png"],
      nsfw_checker: true,
      duration: 3,
    });

    const body = sentBody(fetchMock);
    expect(body.input.nsfw_checker).toBe(true);
    expect(body.input.duration).toBe(3);
  });
});
