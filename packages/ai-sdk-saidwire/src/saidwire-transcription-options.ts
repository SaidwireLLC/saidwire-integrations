import { lazySchema, zodSchema, type InferSchema } from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';

export type SaidwireTranscriptionModelId = 'saidwire-en' | (string & {});

export const saidwireTranscriptionModelOptionsSchema = lazySchema(() =>
  zodSchema(
    z.object({
      /**
       * Language of the audio. Saidwire transcribes English only:
       * `en`, a regional tag such as `en-US`, or `english`. Any other
       * value is rejected by the API with a 400 error.
       */
      language: z.string().optional(),

      /**
       * Timestamp detail to return. Defaults to `['segment']`.
       * Add `'word'` to get per-word timings in
       * `providerMetadata.saidwire.words`.
       */
      timestampGranularities: z.array(z.enum(['word', 'segment'])).optional(),
    }),
  ),
);

export type SaidwireTranscriptionModelOptions = InferSchema<
  typeof saidwireTranscriptionModelOptionsSchema
>;
