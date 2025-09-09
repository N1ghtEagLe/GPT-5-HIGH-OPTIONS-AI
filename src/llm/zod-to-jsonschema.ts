import { z } from 'zod';

// Convert our tool registry to OpenAI Responses API tool definitions
export function toOpenAITools(tools: Record<string, any>) {
  // Responses API expects function tools with top-level name/description/parameters
  // Example: { type: 'function', name, description, parameters, strict }
  return Object.entries(tools).map(([name, t]) => ({
    type: 'function',
    name,
    description: t.description || '',
    parameters: toJsonSchema(t.parameters),
    strict: true,
  }));
}

// Minimal Zod -> JSON Schema converter for our usage
export function toJsonSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return { type: 'object' };

  // Object
  if (schema instanceof (z as any).ZodObject) {
    const shapeGetter = (schema as any)._def.shape;
    const shape = typeof shapeGetter === 'function' ? shapeGetter() : shapeGetter;
    // With strict function calling, OpenAI requires `required` to include
    // every key present in `properties`.
    const required: string[] = [];
    const properties: Record<string, any> = {};

    for (const [key, sub] of Object.entries<any>(shape)) {
      // Even if Zod marks a key optional, the Responses API strict schema
      // requires that `required` includes every property key.
      required.push(key);
      const subSchema = toJsonSchema(sub);
      const desc = sub?._def?.description;
      if (desc) subSchema.description = desc;
      properties[key] = subSchema;
    }

    const out: any = { type: 'object', properties, additionalProperties: false };
    if (required.length) out.required = required;
    const desc = (schema as any)?._def?.description;
    if (desc) out.description = desc;
    return out;
  }

  // Optional unwrap
  if (isZodOptional(schema)) {
    return toJsonSchema(schema._def.innerType);
  }

  const typeName = (schema as any)?._def?.typeName;
  switch (typeName) {
    case 'ZodString':
      return { type: 'string', description: (schema as any)?._def?.description };
    case 'ZodNumber':
      return { type: 'number', description: (schema as any)?._def?.description };
    case 'ZodBoolean':
      return { type: 'boolean', description: (schema as any)?._def?.description };
    case 'ZodArray':
      return {
        type: 'array',
        items: toJsonSchema((schema as any)._def.type),
        description: (schema as any)?._def?.description,
      };
    case 'ZodEnum':
      return {
        type: 'string',
        enum: (schema as any)._def.values,
        description: (schema as any)?._def?.description,
      };
    case 'ZodLiteral':
      return { const: (schema as any)._def.value };
    default:
      // Safe fallback
      return { type: 'string', description: (schema as any)?._def?.description };
  }
}

function isZodOptional(s: any) {
  return s?._def?.typeName === 'ZodOptional' || typeof s?.isOptional === 'function' && s.isOptional();
}
