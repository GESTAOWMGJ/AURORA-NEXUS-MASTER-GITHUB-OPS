import OpenAI from "openai";
import {
  classificationJsonSchema,
  classificationOutputSchema,
  sanitizedClassificationInputSchema,
  type ClassificationOutput,
  type SanitizedClassificationInput,
} from "./contracts.js";

interface ClassifierOptions {
  apiKey: string;
  model?: string;
}

/**
 * Classifica somente metadados previamente sanitizados. O schema rejeita
 * campos extras, impedindo o envio acidental de OCR, nomes ou identificadores.
 */
export async function classifySanitizedMetadata(
  input: SanitizedClassificationInput,
  options: ClassifierOptions,
): Promise<ClassificationOutput> {
  const sanitized = sanitizedClassificationInputSchema.parse(input);
  const client = new OpenAI({ apiKey: options.apiKey });
  const response = await client.responses.create({
    model: options.model ?? "gpt-5.6-luna",
    input: [
      {
        role: "system",
        content:
          "Classifique metadados operacionais WMGJ usando somente os enums do schema. Não infira pessoas, diagnóstico ou fato ausente. Confiança abaixo de 0,60 exige revisão humana.",
      },
      {
        role: "user",
        content: JSON.stringify(sanitized),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "wmgj_document_classification",
        strict: true,
        schema: classificationJsonSchema,
      },
    },
  });

  if (!response.output_text) {
    throw new Error("MODEL_NO_STRUCTURED_OUTPUT");
  }

  return classificationOutputSchema.parse(JSON.parse(response.output_text));
}
