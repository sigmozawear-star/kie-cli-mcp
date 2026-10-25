// MCP Apps widgets for the Kie MCP server: show_candidates, media_upload_widget,
// show_result (+ app-only media_upload_chunk). See README "Widżety (MCP Apps)".
//
// Contract (do not rename): messages sent into the chat by the widgets are
//   WYBÓR <decision_id>: <id>
//   WYBÓR <decision_id>: inaczej — <tekst>
//   WYBÓR <decision_id>: żadne — przerysuj
//   UPLOAD <decision_id>: <url1> · <url2> …
//   REF <task_id>: <url>
//
// Widgets never receive the Kie API key and never call Kie. Uploads go to this
// server (one-time ticket), which forwards the bytes to Kie's file host.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Express, Request, Response } from "express";
import express from "express";
import {
  getTool,
  toInputJsonSchema,
  type ToolContext,
} from "@felores/kie-ai-core";
import { widgetHtml, type WidgetMode } from "./html.js";

export const UI_MIME = "text/html;profile=mcp-app";

export const UI_URIS: Record<WidgetMode, string> = {
  candidates: "ui://kie/candidates.html",
  upload: "ui://kie/upload.html",
  result: "ui://kie/result.html",
};

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const CHUNK_BYTES = 512 * 1024;
const TICKET_TTL_MS = 60 * 60 * 1000;

// Default CDNs Kie serves results/uploads from. Extend with KIE_MCP_MEDIA_DOMAINS
// (comma-separated origins, e.g. "https://cdn.example.com,https://*.foo.net").
const DEFAULT_MEDIA_DOMAINS = [
  "https://tempfile.aiquickdraw.com",
  "https://file.aiquickdraw.com",
  "https://*.aiquickdraw.com",
  "https://tempfile.redpandaai.co",
  "https://*.redpandaai.co",
  "https://*.kie.ai",
];

// ---------------------------------------------------------------- schemas ---

const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "URL must be http(s)");

export const ShowCandidatesSchema = z.object({
  decision_id: z
    .string()
    .min(1)
    .max(200)
    .describe("Identifier of this decision; echoed back in the WYBÓR message"),
  question: z.string().max(2000).describe("Question shown above the grid"),
  candidates: z
    .array(
      z.object({
        id: z.string().min(1).max(100).describe("Candidate id, e.g. 'A'"),
        url: httpUrl.describe("Public URL of the image/video (e.g. a Kie result URL)"),
        kind: z.enum(["image", "video"]),
        label: z.string().max(300).optional(),
      }),
    )
    .min(1)
    .max(24),
  allow_note: z
    .boolean()
    .default(true)
    .describe("Show the free-text 'inaczej: …' field"),
  allow_none: z
    .boolean()
    .default(true)
    .describe("Show the 'Żadne — przerysuj' button"),
});

export const MediaUploadWidgetSchema = z.object({
  decision_id: z.string().min(1).max(200),
  question: z.string().max(2000),
  accept: z
    .array(z.enum(["image", "video"]))
    .min(1)
    .max(2)
    .describe('Allowed media kinds, e.g. ["image"] or ["image","video"]'),
  max_files: z.number().int().min(1).max(20),
});

export const ShowResultSchema = z.object({
  task_ids: z.array(z.string().min(1).max(200)).min(1).max(20),
});

export const MediaUploadChunkSchema = z.object({
  ticket: z.string().min(16).max(128),
  file_id: z.string().min(1).max(64),
  index: z.number().int().min(0).max(999),
  total: z.number().int().min(1).max(1000),
  filename: z.string().max(255),
  content_type: z.string().max(100),
  data_base64: z.string().max(2 * CHUNK_BYTES),
});

// ---------------------------------------------------------- upload store ---

interface Ticket {
  decisionId: string;
  accept: Array<"image" | "video">;
  maxFiles: number;
  urls: string[];
  expiresAt: number;
  partials: Map<string, { total: number; chunks: Buffer[]; got: number; bytes: number }>;
}

type Kind = "image" | "video";

function sniff(bytes: Uint8Array): { kind: Kind; mime: string; ext: string } | null {
  const at = (sig: number[], off = 0) => sig.every((v, i) => bytes[off + i] === v);
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "image", mime: "image/png", ext: "png" };
  if (at([0xff, 0xd8, 0xff])) return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return { kind: "image", mime: "image/webp", ext: "webp" };
  if (at([0x47, 0x49, 0x46, 0x38])) return { kind: "image", mime: "image/gif", ext: "gif" };
  if (at([0x1a, 0x45, 0xdf, 0xa3])) return { kind: "video", mime: "video/webm", ext: "webm" };
  if (at([0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (/^(heic|heix|hevc|mif1|msf1|avif)/.test(brand)) {
      return brand.startsWith("avif")
        ? { kind: "image", mime: "image/avif", ext: "avif" }
        : { kind: "image", mime: "image/heic", ext: "heic" };
    }
    if (brand === "qt  ") return { kind: "video", mime: "video/quicktime", ext: "mov" };
    return { kind: "video", mime: "video/mp4", ext: "mp4" };
  }
  return null;
}

export class WidgetError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function safeName(name: string, ext: string): string {
  const base = (name || "upload")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80)
    .replace(/\.[^.]*$/, "");
  return `${base || "upload"}.${ext}`;
}

function kindOfUrl(url: string): "image" | "video" | "audio" {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (/\.(mp4|mov|webm|m4v|m3u8)$/.test(path)) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(path)) return "audio";
  return "image";
}

function normStatus(raw: unknown): "completed" | "failed" | "processing" {
  const s = String(raw ?? "").toLowerCase();
  if (["completed", "success", "succeeded", "done"].includes(s)) return "completed";
  if (s.includes("fail") || s.includes("error") || s === "sensitive_word_error") return "failed";
  return "processing";
}

// ------------------------------------------------------------------- hub ---

export interface WidgetHubOptions {
  ctx: ToolContext;
  /** Public origin of this server, e.g. https://kie-cli-mcp-e3so.onrender.com. */
  publicBaseUrl: string | null;
}

export class WidgetHub {
  private tickets = new Map<string, Ticket>();
  readonly toolNames = new Set([
    "show_candidates",
    "media_upload_widget",
    "show_result",
    "media_upload_chunk",
  ]);

  constructor(private opts: WidgetHubOptions) {
    setInterval(() => this.sweep(), 5 * 60 * 1000).unref();
  }

  private sweep() {
    const now = Date.now();
    for (const [k, t] of this.tickets) if (t.expiresAt < now) this.tickets.delete(k);
  }

  private mediaDomains(): string[] {
    const extra = (process.env.KIE_MCP_MEDIA_DOMAINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return [...new Set([...DEFAULT_MEDIA_DOMAINS, ...extra])];
  }

  private resourceMeta() {
    const connect = this.opts.publicBaseUrl ? [this.opts.publicBaseUrl] : [];
    return {
      ui: {
        csp: {
          connectDomains: connect,
          resourceDomains: this.mediaDomains(),
        },
        prefersBorder: false,
      },
    };
  }

  // ---- tools/list entries -------------------------------------------------
  listTools() {
    const ui = (mode: WidgetMode, visibility?: string[]) => ({
      ui: { resourceUri: UI_URIS[mode], ...(visibility ? { visibility } : {}) },
      "ui/resourceUri": UI_URIS[mode],
    });
    return [
      {
        name: "show_candidates",
        title: "Pokaż kandydatów do wyboru",
        description:
          "Render an interactive picker in the chat: a grid of candidate images (9:16) or videos with a 'Wybieram <id>' button under each, an 'inaczej: …' free-text field and a 'Żadne — przerysuj' button. " +
          "The user's click is sent back as a USER MESSAGE in exactly one of these forms: 'WYBÓR <decision_id>: <id>' · 'WYBÓR <decision_id>: inaczej — <tekst>' · 'WYBÓR <decision_id>: żadne — przerysuj'. " +
          "After calling this tool, END YOUR TURN and wait for that message; do not poll or call other tools to wait. Candidate URLs must be public (e.g. Kie result URLs).",
        inputSchema: toInputJsonSchema(ShowCandidatesSchema),
        annotations: { readOnlyHint: true, openWorldHint: false },
        _meta: ui("candidates"),
      },
      {
        name: "media_upload_widget",
        title: "Wgraj pliki z komputera",
        description:
          "Render an upload widget so the user can send images/videos from their device. Files are hosted (readable by Kie) and the widget then sends a USER MESSAGE 'UPLOAD <decision_id>: <url1> · <url2> …'. " +
          "Use those URLs as input_urls/image_urls for generation tools. After calling, END YOUR TURN and wait for the UPLOAD message.",
        inputSchema: toInputJsonSchema(MediaUploadWidgetSchema),
        annotations: { readOnlyHint: true, openWorldHint: false },
        _meta: ui("upload"),
      },
      {
        name: "show_result",
        title: "Pokaż wyniki zadań Kie",
        description:
          "Show finished Kie task results (image/video) in the chat with 'Pobierz' (download) and 'Użyj jako referencję' buttons. The latter sends a USER MESSAGE 'REF <task_id>: <url>' — use that URL as a reference input for the next generation.",
        inputSchema: toInputJsonSchema(ShowResultSchema),
        annotations: { readOnlyHint: true, openWorldHint: false },
        _meta: ui("result"),
      },
      {
        name: "media_upload_chunk",
        title: "(internal) upload chunk",
        description:
          "Internal transport used only by the media_upload_widget UI as a fallback upload path. Models must never call this tool.",
        inputSchema: toInputJsonSchema(MediaUploadChunkSchema),
        annotations: { readOnlyHint: false, openWorldHint: false },
        _meta: ui("upload", ["app"]),
      },
    ];
  }

  // ---- resources ------------------------------------------------------------
  listResources() {
    return (Object.keys(UI_URIS) as WidgetMode[]).map((mode) => ({
      uri: UI_URIS[mode],
      name: `kie-widget-${mode}`,
      description: `MCP App UI for the Kie ${mode} widget`,
      mimeType: UI_MIME,
      _meta: this.resourceMeta(),
    }));
  }

  readResource(uri: string) {
    const mode = (Object.keys(UI_URIS) as WidgetMode[]).find((m) => UI_URIS[m] === uri);
    if (!mode) return null;
    return {
      contents: [
        { uri, mimeType: UI_MIME, text: widgetHtml(mode), _meta: this.resourceMeta() },
      ],
    };
  }

  // ---- tools/call -----------------------------------------------------------
  async callTool(name: string, args: unknown) {
    try {
      switch (name) {
        case "show_candidates":
          return this.showCandidates(ShowCandidatesSchema.parse(args ?? {}));
        case "media_upload_widget":
          return this.mediaUploadWidget(MediaUploadWidgetSchema.parse(args ?? {}));
        case "show_result":
          return await this.showResult(ShowResultSchema.parse(args ?? {}));
        case "media_upload_chunk":
          return await this.uploadChunk(MediaUploadChunkSchema.parse(args ?? {}));
      }
      throw new WidgetError(`Unknown widget tool ${name}`);
    } catch (e) {
      const msg =
        e instanceof z.ZodError
          ? "Invalid arguments: " + e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
          : e instanceof Error
            ? e.message
            : String(e);
      return { content: [{ type: "text" as const, text: msg }], isError: true };
    }
  }

  private showCandidates(a: z.infer<typeof ShowCandidatesSchema>) {
    const ids = a.candidates.map((c) => c.id);
    if (new Set(ids).size !== ids.length) throw new WidgetError("Candidate ids must be unique");
    const next =
      `Widget shown with ${a.candidates.length} candidates (${ids.join(", ")}). END YOUR TURN now and wait for the user's message ` +
      `'WYBÓR ${a.decision_id}: <id>' | 'WYBÓR ${a.decision_id}: inaczej — <tekst>' | 'WYBÓR ${a.decision_id}: żadne — przerysuj'.`;
    return {
      content: [{ type: "text" as const, text: next }],
      structuredContent: { ...a, next_step: next },
    };
  }

  private mediaUploadWidget(a: z.infer<typeof MediaUploadWidgetSchema>) {
    const ticket = randomBytes(24).toString("base64url");
    this.tickets.set(ticket, {
      decisionId: a.decision_id,
      accept: [...new Set(a.accept)],
      maxFiles: a.max_files,
      urls: [],
      expiresAt: Date.now() + TICKET_TTL_MS,
      partials: new Map(),
    });
    const base = this.opts.publicBaseUrl;
    const next =
      `Upload widget shown (max ${a.max_files} file(s): ${a.accept.join("/")}). END YOUR TURN now and wait for the user's message ` +
      `'UPLOAD ${a.decision_id}: <url1> · <url2> …'.`;
    return {
      content: [{ type: "text" as const, text: next }],
      structuredContent: {
        ...a,
        upload: {
          url: base ? `${base}/upload/${ticket}` : null,
          ticket,
          expires_at: new Date(Date.now() + TICKET_TTL_MS).toISOString(),
          max_image_bytes: MAX_IMAGE_BYTES,
          max_video_bytes: MAX_VIDEO_BYTES,
          chunk_bytes: CHUNK_BYTES,
        },
        next_step: next,
      },
    };
  }

  private async showResult(a: z.infer<typeof ShowResultSchema>) {
    const statusTool = getTool("get_task_status");
    const results = await Promise.all(
      [...new Set(a.task_ids)].map(async (task_id) => {
        let parsed: any = null;
        try {
          const out = await statusTool!.run({ task_id }, this.opts.ctx);
          parsed = JSON.parse(out.content?.[0]?.text ?? "null");
        } catch {
          parsed = null;
        }
        const local = await this.opts.ctx.db.getTask(task_id).catch(() => null);
        const urls: string[] = (
          Array.isArray(parsed?.result_urls) ? parsed.result_urls : []
        ).filter((u: unknown) => typeof u === "string" && /^https?:\/\//i.test(u));
        if (!urls.length && local?.result_url) urls.push(local.result_url);
        let status = normStatus(parsed?.status ?? local?.status);
        if (!local && !parsed?.api_response?.data) status = "not_found" as any;
        if (status === "completed" && !urls.length && local?.status !== "completed") status = "processing";
        return {
          task_id,
          api_type: local?.api_type ?? null,
          status,
          items: urls.map((url) => ({ url, kind: kindOfUrl(url) })),
          error: parsed?.error ?? local?.error_message ?? null,
        };
      }),
    );
    const lines = results.map((r) =>
      r.items.length
        ? `${r.task_id}: ${r.status} → ${r.items.map((i) => i.url).join(" , ")}`
        : `${r.task_id}: ${r.status}${r.error ? ` (${r.error})` : ""}`,
    );
    const text =
      `Results shown in widget.\n${lines.join("\n")}\n` +
      `If the user clicks 'Użyj jako referencję' you will receive 'REF <task_id>: <url>'.`;
    return { content: [{ type: "text" as const, text }], structuredContent: { results } };
  }

  // ---- uploads --------------------------------------------------------------
  private getTicket(ticket: string): Ticket {
    const t = this.tickets.get(ticket);
    if (!t || t.expiresAt < Date.now()) throw new WidgetError("Upload link expired or invalid", 403);
    return t;
  }

  async acceptFile(ticket: string, bytes: Buffer, filename: string) {
    const t = this.getTicket(ticket);
    if (t.urls.length >= t.maxFiles) throw new WidgetError(`File limit reached (${t.maxFiles})`, 409);
    const info = sniff(bytes);
    if (!info) throw new WidgetError("Unsupported file type (expected PNG/JPEG/WebP/GIF/HEIC or MP4/MOV/WebM)", 415);
    if (!t.accept.includes(info.kind)) throw new WidgetError(`This widget does not accept ${info.kind} files`, 415);
    const limit = info.kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (bytes.length === 0 || bytes.length > limit) throw new WidgetError(`File too large (max ${Math.round(limit / 1048576)} MB)`, 413);

    const response: any = await this.opts.ctx.client.uploadFile({
      bytes: new Uint8Array(bytes),
      filename: safeName(filename, info.ext),
      contentType: info.mime,
    });
    const url: string | undefined = response?.data?.fileUrl || response?.data?.downloadUrl;
    if (!url) throw new WidgetError(`Kie upload failed: ${response?.msg || "no URL returned"}`, 502);
    // Re-check after the async upload (parallel uploads race on the limit).
    if (t.urls.length >= t.maxFiles) throw new WidgetError(`File limit reached (${t.maxFiles})`, 409);
    t.urls.push(url);
    return { url, kind: info.kind, mime: info.mime, bytes: bytes.length };
  }

  private async uploadChunk(a: z.infer<typeof MediaUploadChunkSchema>) {
    const t = this.getTicket(a.ticket);
    let p = t.partials.get(a.file_id);
    if (!p) {
      if (t.partials.size >= t.maxFiles * 2) throw new WidgetError("Too many parallel uploads");
      p = { total: a.total, chunks: new Array(a.total), got: 0, bytes: 0 };
      t.partials.set(a.file_id, p);
    }
    if (a.total !== p.total || a.index >= p.total) throw new WidgetError("Chunk index out of range");
    const buf = Buffer.from(a.data_base64, "base64");
    if (buf.length > CHUNK_BYTES) throw new WidgetError("Chunk too large");
    if (!p.chunks[a.index]) {
      p.chunks[a.index] = buf;
      p.got++;
      p.bytes += buf.length;
    }
    if (p.bytes > MAX_VIDEO_BYTES) {
      t.partials.delete(a.file_id);
      throw new WidgetError("File too large");
    }
    if (p.got < p.total) {
      return {
        content: [{ type: "text" as const, text: `chunk ${a.index + 1}/${a.total} received` }],
        structuredContent: { received: p.got, total: p.total },
      };
    }
    t.partials.delete(a.file_id);
    const result = await this.acceptFile(a.ticket, Buffer.concat(p.chunks), a.filename);
    return {
      content: [{ type: "text" as const, text: `uploaded: ${result.url}` }],
      structuredContent: { received: p.total, total: p.total, ...result },
    };
  }

  /** Mounts POST /upload/:ticket (CORS, no bearer — the one-time ticket is the credential). */
  registerRoutes(app: Express, publicBaseUrl?: string) {
    if (publicBaseUrl && !this.opts.publicBaseUrl) this.opts.publicBaseUrl = publicBaseUrl;
    const cors = (res: Response) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-File-Name");
      res.setHeader("Access-Control-Max-Age", "600");
      // Chrome Private Network Access preflight (only matters for local/LAN servers).
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.setHeader("Cache-Control", "no-store");
    };
    app.options("/upload/:ticket", (_req: Request, res: Response) => {
      cors(res);
      res.status(204).end();
    });
    app.post(
      "/upload/:ticket",
      (req: Request, res: Response, next) => {
        cors(res);
        // Fail fast on bad tickets before buffering the body.
        try {
          this.getTicket(req.params.ticket);
        } catch (e) {
          res.status(403).json({ error: (e as Error).message });
          return;
        }
        next();
      },
      express.raw({ type: () => true, limit: MAX_VIDEO_BYTES + 1024 }),
      async (req: Request, res: Response) => {
        try {
          const raw = req.body;
          if (!Buffer.isBuffer(raw) || raw.length === 0) throw new WidgetError("Empty body");
          let name = "upload";
          try {
            name = decodeURIComponent(String(req.headers["x-file-name"] || "upload"));
          } catch {
            /* keep default */
          }
          const out = await this.acceptFile(req.params.ticket, raw, name);
          res.json(out);
        } catch (e) {
          const status = e instanceof WidgetError ? e.status : 502;
          console.error("[Kie.ai MCP] upload failed:", (e as Error).message);
          res.status(status).json({ error: (e as Error).message });
        }
      },
    );
    // Body-parser errors (e.g. 413) → JSON with CORS headers so the widget can read them.
    app.use("/upload", (err: any, _req: Request, res: Response, _next: any) => {
      cors(res);
      res.status(err?.status || 400).json({ error: err?.type === "entity.too.large" ? "File too large" : String(err?.message || err) });
    });
  }
}
