import { Schema } from 'https://esm.run/firebase/ai';

/**
 * Converts a standard JSON Schema object into a Firebase Vertex AI Schema class instance.
 * * @param {Object} jsonSchema - The standard JSON Schema object.
 * @returns {Schema} - The Firebase Vertex AI Schema instance.
 */
export function convertJsonSchemaToVertexSchema(jsonSchema) {
  if (!jsonSchema) return undefined;

  // Extract common base parameters supported by all Schema types
  const baseParams = {
    description: jsonSchema.description,
    nullable: jsonSchema.nullable || false,
    format: jsonSchema.format,
  };

  // Handle "type": ["string", "null"] pattern common in JSON Schema
  if (Array.isArray(jsonSchema.type) && jsonSchema.type.includes('null')) {
    baseParams.nullable = true;
    jsonSchema.type = jsonSchema.type.find((t) => t !== 'null');
  }

  // SWITCH based on schema type
  switch (jsonSchema.type) {
    case 'string':
      // Check for Enums
      if (jsonSchema.enum && Array.isArray(jsonSchema.enum)) {
        return Schema.enumString({
          ...baseParams,
          enum: jsonSchema.enum,
        });
      }
      return Schema.string(baseParams);

    case 'number':
      return Schema.number(baseParams);

    case 'integer':
      return Schema.integer(baseParams);

    case 'boolean':
      return Schema.boolean(baseParams);

    case 'array':
      return Schema.array({
        ...baseParams,
        // Recursively convert the 'items' schema
        items: convertJsonSchemaToVertexSchema(jsonSchema.items),
      });

    case 'object':
      const properties = {};
      const allPropertyKeys = jsonSchema.properties
        ? Object.keys(jsonSchema.properties)
        : [];

      // Recursively convert each property
      allPropertyKeys.forEach((key) => {
        properties[key] = convertJsonSchemaToVertexSchema(
          jsonSchema.properties[key]
        );
      });

      // Calculate optionalProperties
      // JSON Schema uses "required" (allowlist), Vertex SDK uses "optionalProperties" (blocklist)
      const required = jsonSchema.required || [];
      const optionalProperties = allPropertyKeys.filter(
        (key) => !required.includes(key)
      );

      return Schema.object({
        ...baseParams,
        properties: properties,
        optionalProperties: optionalProperties,
      });

    default:
      // Fallback for unknown types or complex types not fully supported (like oneOf)
      // defaulting to string usually prevents crashes, but use with caution.
      console.warn(
        `Unsupported type: ${jsonSchema.type}, defaulting to string.`
      );
      return Schema.string(baseParams);
  }
}
