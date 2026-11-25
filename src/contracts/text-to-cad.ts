/**
 * Text-to-CAD contracts (text-to-cad / cadgen integration) and the Kids & Family project templates.
 *
 * Engine: cadgen (MIT, earthtojake/text-to-cad), a build123d / Open CASCADE runtime. It runs in the
 * CAD worker in its own Python environment, one sandboxed process per build: no network, no shared
 * daemon or cache, telemetry off. Two inputs reach it:
 *
 *   1. Make AI scripts: a build123d model written by the Make AI agent from the buyer's words.
 *      Untrusted code: the worker gates it statically (allowed imports and names only) before it
 *      runs, and the result is a DRAFT version that the buyer must approve before any quote.
 *   2. Kid project templates: our own parametric build123d models. Kids choose a template and a few
 *      bounded options; they never type free-form design text and no model is generated for them.
 *
 * A second engine builds Make AI models when TEXT_TO_CAD_ENGINE=solidcraft: SolidCraft
 * (tangency-labs/solidcraft, MIT OR Apache-2.0). Its model is DATA, not code: a JSON list of engine
 * commands, checked against an allow-list and built by `solidcraft-cli` in the same sandbox. Its
 * named parameters come back with the build, with the saved design (`model.sc`), so the buyer can
 * change a size and get a new version without Make AI writing the model again: the worker applies
 * the new values to that design, where every edge and face pick follows its geometry.
 *
 * Worker routes (services/cad-worker, bearer CAD_WORKER_TOKEN, like /v1/generate):
 *   POST /v1/text-to-cad/build              TextToCadBuildRequest -> TextToCadBuildResponse
 *   POST /v1/kid-templates/{template}/build KidTemplateBuildRequest -> TextToCadBuildResponse
 *   POST /v1/solidcraft/build               SolidcraftBuildRequest -> TextToCadBuildResponse (+ design)
 *   POST /v1/solidcraft/rebuild             SolidcraftRebuildRequest -> TextToCadBuildResponse (+ design)
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Worker: build a model
// ---------------------------------------------------------------------------

export const TEXT_TO_CAD_OUTPUTS = ['step', 'glb', 'stl'] as const;
export const TextToCadOutput = z.enum(TEXT_TO_CAD_OUTPUTS);
export type TextToCadOutput = z.infer<typeof TextToCadOutput>;

/**
 * Largest model script the worker accepts (bytes of UTF-8). Kept well under the worker's request-body
 * cap for these routes (TEXT_TO_CAD_MAX_BODY_BYTES), so JSON framing and escaping never push a valid
 * script over it.
 */
export const TEXT_TO_CAD_MAX_SCRIPT_BYTES = 48 * 1024;
/** Request-body cap the worker applies to the text-to-CAD and kid-template routes. */
export const TEXT_TO_CAD_MAX_BODY_BYTES = 256 * 1024;

export const TextToCadBuildRequest = z.object({
    /** A cadgen model: one parameterless function decorated with @step/@glb/@stl returning a build123d shape. */
    script: z.string().min(1).max(TEXT_TO_CAD_MAX_SCRIPT_BYTES),
    outputs: z.array(TextToCadOutput).min(1).default(['step', 'glb', 'stl']),
});
export type TextToCadBuildRequest = z.infer<typeof TextToCadBuildRequest>;

export const TextToCadArtifact = z.object({
    kind: TextToCadOutput,
    filename: z.string(),
    content_base64: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.number().int().nonnegative(),
});
export type TextToCadArtifact = z.infer<typeof TextToCadArtifact>;

export const TEXT_TO_CAD_ENGINES = ['cadgen', 'solidcraft'] as const;
export const TextToCadEngineName = z.enum(TEXT_TO_CAD_ENGINES);
export type TextToCadEngineName = z.infer<typeof TextToCadEngineName>;
export const TextToCadEngine = z.object({ name: TextToCadEngineName, version: z.string() });
export type TextToCadEngine = z.infer<typeof TextToCadEngine>;

// ---------------------------------------------------------------------------
// SolidCraft: a model is a list of engine commands (data), never code
// ---------------------------------------------------------------------------

/** Mirrors the worker gate's bounds (services/cad-worker/cad_worker/solidcraft/gate.py). */
export const SOLIDCRAFT_MAX_COMMANDS = 400;
export const SOLIDCRAFT_MAX_SCRIPT_BYTES = 192 * 1024;
export const SOLIDCRAFT_MAX_OVERRIDES = 64;

export const SolidcraftStep = z.object({ command: z.string().min(3).max(80).regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/), params: z.record(z.unknown()).default({}) }).strict();
export const SolidcraftScript = z.object({ commands: z.array(SolidcraftStep).min(1).max(SOLIDCRAFT_MAX_COMMANDS) }).strict();
export type SolidcraftScript = z.infer<typeof SolidcraftScript>;

export const SolidcraftParameterName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 'Parameter names are letters, digits and _.');
/** A length, angle or count: numbers, names, units and arithmetic. No quotes. */
export const SolidcraftExpression = z
    .string()
    .trim()
    .min(1, 'Type a value, for example 80 mm.')
    .max(80)
    .regex(/^(?!.*--)[A-Za-z0-9_ .+\-*/()^,]+$/, 'Use a number with its unit, for example 80 mm.');
export const SolidcraftOverrides = z.record(SolidcraftParameterName, SolidcraftExpression).refine((o) => Object.keys(o).length <= SOLIDCRAFT_MAX_OVERRIDES, `At most ${SOLIDCRAFT_MAX_OVERRIDES} values at once.`);
export type SolidcraftOverrides = z.infer<typeof SolidcraftOverrides>;

export const SolidcraftBuildRequest = z.object({
    script: SolidcraftScript,
    outputs: z.array(TextToCadOutput).min(1).default(['step', 'glb', 'stl']),
});
export type SolidcraftBuildRequest = z.infer<typeof SolidcraftBuildRequest>;

/** Largest saved design the worker writes or reopens (bytes). */
export const SOLIDCRAFT_MAX_DESIGN_BYTES = 20 * 1024 * 1024;

export const SolidcraftRebuildRequest = z.object({
    /** A design this worker saved, with the sha256 it reported (it refuses anything else). */
    design: z.object({ content_base64: z.string().min(4), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
    /** Name -> new expression, applied as the engine's --param NAME=EXPR. */
    parameters: SolidcraftOverrides.refine((o) => Object.keys(o).length > 0, 'Change at least one size.'),
    outputs: z.array(TextToCadOutput).min(1).default(['step', 'glb', 'stl']),
});
export type SolidcraftRebuildRequest = z.infer<typeof SolidcraftRebuildRequest>;

/** SolidCraft's saved design (`model.sc`): the timeline and parameters the next size change opens. */
export const SolidcraftDesignFile = z.object({
    filename: z.literal('model.sc'),
    content_base64: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.number().int().nonnegative().max(SOLIDCRAFT_MAX_DESIGN_BYTES),
});

/** A named size of the model that a person can change (SolidCraft's user parameters). */
export const TextToCadParameter = z.object({
    name: SolidcraftParameterName,
    expression: z.string().max(80),
    value: z.number().nullable(),
    unit: z.string().max(12),
    comment: z.string().max(200).default(''),
});
export type TextToCadParameter = z.infer<typeof TextToCadParameter>;

/** Facts measured on the built solid by the worker's own check (never by the submitted script). */
export const TextToCadGeometry = z.object({
    bbox_mm: z.tuple([z.number().nonnegative(), z.number().nonnegative(), z.number().nonnegative()]),
    volume_mm3: z.number().nonnegative(),
    area_mm2: z.number().nonnegative(),
    solids: z.number().int().nonnegative(),
    /** Closed, valid solid geometry (cadgen.geometry.is_sound). */
    sound: z.boolean(),
});
export type TextToCadGeometry = z.infer<typeof TextToCadGeometry>;

export const TEXT_TO_CAD_ERROR_CODES = [
    'GATE_REJECTED', // the script uses a forbidden import, name or construct; nothing ran
    'BUILD_FAILED', // the model raised or produced no solid
    'TIMEOUT',
    'TOO_LARGE', // an output exceeded the size cap
    'UNAVAILABLE', // the cadgen runtime is not installed on this worker
] as const;
export const TextToCadErrorCode = z.enum(TEXT_TO_CAD_ERROR_CODES);

export const TextToCadBuildResponse = z.discriminatedUnion('ok', [
    z.object({
        ok: z.literal(true),
        engine: TextToCadEngine,
        artifacts: z.array(TextToCadArtifact),
        geometry: TextToCadGeometry,
        /** SolidCraft only: the model's named parameters after the build. */
        parameters: z.array(TextToCadParameter).max(64).default([]),
        /** SolidCraft builds only: the exact script that produced these files (not on a rebuild). */
        script: SolidcraftScript.optional(),
        /** SolidCraft only: the saved design, for the next size change. */
        design: SolidcraftDesignFile.optional(),
        warnings: z.array(z.string()),
        build_ms: z.number().int().nonnegative(),
    }),
    z.object({
        ok: z.literal(false),
        code: TextToCadErrorCode,
        /** Plain-language reason, safe to show (never a stack trace or a server path). */
        message: z.string(),
        /** For GATE_REJECTED: each rule the script broke, with its line. */
        violations: z.array(z.object({ line: z.number().int().nonnegative(), rule: z.string() })).default([]),
    }),
]);
export type TextToCadBuildResponse = z.infer<typeof TextToCadBuildResponse>;

// ---------------------------------------------------------------------------
// Kids & Family: project templates
// ---------------------------------------------------------------------------

/** Letters, digits and spaces only: no symbols, emails, phone numbers or links can be spelled out. */
export const KidLabel = z
    .string()
    .trim()
    .min(1, 'Type at least one letter.')
    .max(12, 'Use 12 letters or fewer.')
    .regex(/^[A-Za-z0-9 ]+$/, 'Use letters, numbers and spaces only.');

export const KID_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black', 'white'] as const;
export const KidColor = z.enum(KID_COLORS);
export type KidColor = z.infer<typeof KidColor>;

export const KID_TEMPLATE_IDS = ['name_keychain', 'phone_stand', 'bookmark', 'desk_tidy', 'bike_hook'] as const;
export const KidTemplateId = z.enum(KID_TEMPLATE_IDS);
export type KidTemplateId = z.infer<typeof KidTemplateId>;

export const KidTemplateParams = {
    name_keychain: z.object({ label: KidLabel, color: KidColor, size: z.enum(['small', 'big']).default('small') }),
    phone_stand: z.object({ color: KidColor, angle: z.enum(['low', 'medium', 'tall']).default('medium'), label: KidLabel.optional() }),
    bookmark: z.object({ label: KidLabel, color: KidColor, shape: z.enum(['rounded', 'arrow', 'star']).default('rounded') }),
    desk_tidy: z.object({ color: KidColor, cups: z.number().int().min(2).max(4).default(3), label: KidLabel.optional() }),
    bike_hook: z.object({ color: KidColor, label: KidLabel.optional() }),
} as const satisfies Record<KidTemplateId, z.ZodTypeAny>;
export type KidTemplateParams<T extends KidTemplateId> = z.infer<(typeof KidTemplateParams)[T]>;

/**
 * Body of POST /v1/kid-templates/{template}/build: the template id (which must equal the path
 * segment) and that template's own params, validated by its schema on both sides.
 */
export const KidTemplateBuildRequest = z.discriminatedUnion('template', [
    z.object({ template: z.literal('name_keychain'), params: KidTemplateParams.name_keychain }),
    z.object({ template: z.literal('phone_stand'), params: KidTemplateParams.phone_stand }),
    z.object({ template: z.literal('bookmark'), params: KidTemplateParams.bookmark }),
    z.object({ template: z.literal('desk_tidy'), params: KidTemplateParams.desk_tidy }),
    z.object({ template: z.literal('bike_hook'), params: KidTemplateParams.bike_hook }),
]);
export type KidTemplateBuildRequest = z.infer<typeof KidTemplateBuildRequest>;

/** Copy for kids: short words, one idea per line (target reading age about 8). */
export const KID_TEMPLATES: Record<KidTemplateId, { title: string; blurb: string; ages: '6+' | '8+' | '10+' }> = {
    name_keychain: { title: 'Name keychain', blurb: 'Your name on a tag for your bag or keys.', ages: '6+' },
    phone_stand: { title: 'Phone stand', blurb: 'Holds a phone or tablet up so you can watch.', ages: '8+' },
    bookmark: { title: 'Bookmark', blurb: 'Keep your page with your name on it.', ages: '6+' },
    desk_tidy: { title: 'Desk tidy', blurb: 'Cups for pens, pencils and markers.', ages: '8+' },
    bike_hook: { title: 'Bike hook', blurb: 'Hang your helmet or bag on the wall.', ages: '10+' },
};

/** Parse a template's params with its own schema (throws ZodError with kid-friendly messages). */
export function parseKidTemplateParams<T extends KidTemplateId>(template: T, params: unknown): KidTemplateParams<T> {
    return KidTemplateParams[template].parse(params) as KidTemplateParams<T>;
}
