import { z } from "zod";
import { NEEDS_ORIGIN, USE_NAMES } from "./uses.js";

// The CloudCrane app spec: an A2UI surface (the screens) in a small envelope for
// what A2UI doesn't cover. Nothing in it is code from the app it came from:
// screens are A2UI components, the look is DTCG design tokens, rules are CEL
// expressions, saved data is described by a JSON Schema. Strict throughout, so a
// field the spec doesn't define (where code could hide) is refused. The one
// place code belongs is a coded component's, run sandboxed, said so where the
// app is installed.

/** A neutral id: lower-case words, dots, dashes, underscores. Partner symbol names live only in provenance. */
export const Id = z.string().regex(/^[a-z][a-zA-Z0-9_.-]{0,63}$/, "an id: a letter, then letters, digits, . _ or -, at most 64");
/** A CEL identifier (constants and parameters): letters, digits and underscores. */
export const CelName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, "a CEL identifier: letters, digits and _");
/** An RFC 6901 JSON Pointer. */
export const Pointer = z.string().regex(/^(\/([^~/]|~[01])*)*$/, "a JSON Pointer, like /saved/days");
/** A pointer, or a pointer ending in /* for everything under it (mod points). */
export const PointerPattern = z.string().regex(/^(\/([^~/*]|~[01])*)*(\/\*)?$/, "a JSON Pointer, optionally ending in /*");
const Text = (max: number) => z.string().min(1).max(max);

/** DTCG Format 2025.10 (designtokens.org): a token has $value; a group holds tokens and groups. */
const DTCG_TYPES = [
  "color",
  "dimension",
  "fontFamily",
  "fontWeight",
  "duration",
  "cubicBezier",
  "number",
  "strokeStyle",
  "border",
  "transition",
  "shadow",
  "gradient",
  "typography",
] as const;
export type TokenNode = { $value?: unknown; $type?: string; $description?: string; [name: string]: unknown };
export const Tokens: z.ZodType<TokenNode> = z.lazy(() =>
  z
    .object({ $value: z.unknown().optional(), $type: z.enum(DTCG_TYPES).optional(), $description: z.string().max(200).optional() })
    .catchall(Tokens)
    .superRefine((node, ctx) => {
      const children = Object.keys(node).filter((k) => !k.startsWith("$"));
      if (node.$value !== undefined && children.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a token can't also be a group" });
      for (const k of children) if (!/^[A-Za-z0-9_-]{1,40}$/.test(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `token name "${k}"` });
    }),
);

/** A CEL expression (cel.dev); parsed and checked by the logic validator. */
const Cel = z.string().min(1).max(4000);

/** The kinds of value a coded component is given or sends: JSON's, by name. */
export const CODED_TYPES = ["number", "string", "boolean", "list", "map"] as const;
const CodedType = z.enum(CODED_TYPES);

/**
 * A coded component: what the catalog can't draw, as the spec's own code, run
 * sandboxed in a frame with a kit (`game`: a loop, a canvas, touch and keys;
 * `page`: a whole HTML page, full screen). Either saves through `localStorage`,
 * which the frame's bridge keeps on the page under the spec's data key.
 * It's given only its declared inputs and may only send its declared events;
 * a screen places it with the catalog's Coded component.
 */
export const CodedComponent = z
  .object({
    kind: z.literal("coded"),
    /** game: a canvas, a loop and touch, the code a script; page: a whole HTML page, drawn full screen (what an app written as HTML becomes). */
    kit: z.enum(["game", "page"]),
    inputs: z.record(CelName, CodedType).default({}),
    events: z.record(CelName, z.record(CelName, CodedType)).default({}),
    code: z
      .string()
      .min(1)
      .max(1024 * 1024),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.kit === "game" && /<\/script/i.test(c.code))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["code"],
        message: "can't contain </script>, which would end the frame's script (a page kit's code can)",
      });
    if (c.kit === "game" && c.code.length > 64 * 1024)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["code"], message: "a game kit's code is at most 64 KB" });
  })
  .refine((c) => Object.keys(c.inputs).length <= 10 && Object.keys(c.events).length <= 10, "at most 10 inputs and 10 events");

export const SpecSchema = z
  .object({
    v: z.literal(1),
    manifest: z
      .object({
        runtime: z.string().regex(/^\d+\.\d+\.\d+$/, "the runtime version, like 0.1.0"),
        generator: Text(80),
        source: z.object({ fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/, "sha256:<64 hex>: a hash of the source, never the source") }).strict(),
      })
      .strict(),
    module: z
      .object({
        id: Id,
        name: Text(60),
        purpose: Text(400),
        /** How CloudCrane lists it: one of its icon names, its category, up to five tags (CloudCrane checks them). */
        icon: z
          .string()
          .regex(/^[a-z][a-z0-9-]{0,39}$/)
          .optional(),
        category: z
          .string()
          .regex(/^[a-z][a-z0-9-]{0,39}$/)
          .optional(),
        tags: z
          .array(
            z
              .string()
              .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
              .max(24),
          )
          .max(5)
          .optional(),
      })
      .strict(),
    tokens: Tokens,
    /** A2UI v0.9.1 messages, the way A2UI's own samples hold them; checked by surfaceProblems. */
    surface: z.object({ catalog: z.string().url(), messages: z.array(z.record(z.unknown())).min(2).max(200) }).strict(),
    data: z
      .object({
        version: z.number().int().min(1),
        /** Where it's saved on the phone. */
        key: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/),
        /** The part of the A2UI data model that's saved; the rest is screen state. */
        persist: Pointer,
        /** JSON Schema of the saved data. */
        schema: z.record(z.unknown()),
        initial: z.unknown(),
        /**
         * Two-way views: the runtime keeps `path` equal to the data at `source` (a
         * pointer with A2UI's ${/path} interpolation, like /saved/days/${/ui/selected}),
         * and writes edits made through the view back there. For lists a screen shows
         * by a choice the person makes, since A2UI templates take a fixed path.
         */
        views: z
          .array(z.object({ path: Pointer, source: z.string().regex(/^(\/([^~/$]|~[01]|\$\{\/[^}]*\})*)+$/, "a pointer, with ${/path} parts") }).strict())
          .max(10)
          .default([]),
        /** Each step turns version `from` into `to`, as a CEL expression over `saved`. */
        migrations: z.array(z.object({ from: z.number().int().min(1), to: z.number().int().min(2), cel: Cel }).strict()),
      })
      .strict(),
    logic: z
      .object({
        consts: z.record(CelName, z.union([z.number(), z.string(), z.boolean()])).default({}),
        functions: z.record(CelName, z.object({ params: z.array(CelName).max(8), cel: Cel }).strict()).default({}),
        /** Values the screens read, kept up to date: a data-model pointer and the CEL that computes it. */
        computed: z.record(Pointer, Cel).default({}),
        /** Examples each function must reproduce: recorded from the source's own tests, or given. */
        vectors: z.array(z.object({ fn: CelName, in: z.array(z.unknown()).max(8), out: z.unknown(), from: z.enum(["recorded", "hint"]) }).strict()).default([]),
      })
      .strict(),
    network: z
      .array(z.object({ site: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/), why: Text(300) }).strict())
      .max(5)
      .default([]),
    /** The device features the app uses, by CloudCrane's names, each once with why; anything not listed is blocked. */
    uses: z
      .array(z.object({ what: z.enum(USE_NAMES), why: Text(300) }).strict())
      .max(USE_NAMES.length)
      .default([]),
    journeys: z
      .array(
        z
          .object({
            id: z.string().regex(/^J-\d+$/),
            title: Text(120),
            steps: z.array(z.object({ id: z.string().regex(/^J-\d+\.\d+$/), text: Text(400) }).strict()).min(1),
          })
          .strict(),
      )
      .min(1),
    promises: z.array(z.object({ id: z.string().regex(/^P-\d+$/), text: Text(400), kind: z.literal("data").optional() }).strict()).default([]),
    /** CloudCrane's test steps, as its blueprint tests take them; CloudCrane checks their shape. */
    tests: z.array(z.record(z.unknown())).max(30).default([]),
    /** Coded components, by name: the spec's own code for what the catalog can't draw. */
    components: z
      .record(Id, CodedComponent)
      .refine((c) => Object.keys(c).length <= 5, "at most 5 components")
      .default({}),
    /** The page-kit component that is the whole app: the spec is then that page, compiled to its HTML as written (see page.ts). */
    page: Id.optional(),
    /** What a remix may change and what stays as the partner made it. */
    mods: z
      .object({ open: z.array(PointerPattern), locked: z.array(PointerPattern) })
      .strict()
      .default({ open: [], locked: [] }),
  })
  .strict()
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    for (const u of s.uses) {
      if (seen.has(u.what)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["uses"], message: `${u.what} is listed twice` });
      seen.add(u.what);
    }
    const needsOrigin = s.uses.some((u) => NEEDS_ORIGIN.includes(u.what));
    if (needsOrigin && !Object.values(s.components).some((c) => c.kit === "page"))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["uses"], message: "the camera and microphone work only in a page-kit component" });
  });

export type Spec = z.infer<typeof SpecSchema>;
