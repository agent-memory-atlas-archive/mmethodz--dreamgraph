import type { z } from "zod";
/** UI constraints are descriptive; the daemon still applies the original Zod schema. */
export function settingSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const definition = schema._def;
  switch (definition.typeName) {
    case "ZodOptional": case "ZodNullable": return { ...settingSchema(definition.innerType), [definition.typeName === "ZodOptional" ? "optional" : "nullable"]: true };
    case "ZodDefault": return { ...settingSchema(definition.innerType), default: definition.defaultValue() };
    case "ZodEffects": return { ...settingSchema(definition.schema), daemon_cross_field_validation: true };
    case "ZodString": return { type: "string", checks: definition.checks.map((check: Record<string, unknown>) => ({ ...check, ...(check.regex instanceof RegExp ? { regex: check.regex.source } : {}) })) };
    case "ZodNumber": return { type: definition.checks.some((check: { kind: string }) => check.kind === "int") ? "integer" : "number", checks: definition.checks };
    case "ZodBoolean": return { type: "boolean" };
    case "ZodEnum": return { type: "string", enum: definition.values };
    case "ZodLiteral": return { const: definition.value };
    case "ZodArray": return { type: "array", items: settingSchema(definition.type), minItems: definition.minLength?.value, maxItems: definition.maxLength?.value };
    case "ZodObject": return { type: "object", properties: Object.fromEntries(Object.entries(definition.shape()).map(([key, value]) => [key, settingSchema(value as z.ZodTypeAny)])), additionalProperties: definition.unknownKeys !== "strict" };
    case "ZodRecord": return { type: "object", propertyNames: settingSchema(definition.keyType), additionalProperties: settingSchema(definition.valueType) };
    case "ZodUnion": return { anyOf: definition.options.map(settingSchema) };
    case "ZodNull": return { type: "null" };
    default: throw new Error(`CONFIG_SCHEMA_KIND_UNREPRESENTED: ${definition.typeName}`);
  }
}
