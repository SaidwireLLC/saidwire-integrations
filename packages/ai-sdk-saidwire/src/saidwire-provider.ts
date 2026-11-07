import {
  NoSuchModelError,
  type EmbeddingModelV4,
  type ImageModelV4,
  type LanguageModelV4,
  type ProviderV4,
  type TranscriptionModelV4,
} from '@ai-sdk/provider';
import {
  loadApiKey,
  withoutTrailingSlash,
  withUserAgentSuffix,
  type FetchFunction,
} from '@ai-sdk/provider-utils';
import { SaidwireTranscriptionModel } from './saidwire-transcription-model';
import type { SaidwireTranscriptionModelId } from './saidwire-transcription-options';
import { VERSION } from './version';

export interface SaidwireProviderSettings {
  /**
   * Saidwire API key (`sk_live_...`). Defaults to the `SAIDWIRE_API_KEY`
   * environment variable.
   */
  apiKey?: string;

  /**
   * Base URL for API calls. Defaults to `https://api.saidwire.com/v1`.
   */
  baseURL?: string;

  /**
   * Extra headers sent with every request.
   */
  headers?: Record<string, string>;

  /**
   * Custom fetch implementation, e.g. for testing or proxies.
   */
  fetch?: FetchFunction;
}

export interface SaidwireProvider extends ProviderV4 {
  (modelId: SaidwireTranscriptionModelId): TranscriptionModelV4;

  /** Creates a transcription model. */
  transcriptionModel(modelId: SaidwireTranscriptionModelId): TranscriptionModelV4;

  /** Alias of `transcriptionModel`. */
  transcription(modelId: SaidwireTranscriptionModelId): TranscriptionModelV4;

  /** Saidwire has no language models. Throws `NoSuchModelError`. */
  languageModel(modelId: string): LanguageModelV4;

  /** Saidwire has no embedding models. Throws `NoSuchModelError`. */
  embeddingModel(modelId: string): EmbeddingModelV4;

  /** Saidwire has no image models. Throws `NoSuchModelError`. */
  imageModel(modelId: string): ImageModelV4;
}

export function createSaidwire(options: SaidwireProviderSettings = {}): SaidwireProvider {
  const baseURL = withoutTrailingSlash(options.baseURL) ?? 'https://api.saidwire.com/v1';

  const getHeaders = () =>
    withUserAgentSuffix(
      {
        Authorization: `Bearer ${loadApiKey({
          apiKey: options.apiKey,
          environmentVariableName: 'SAIDWIRE_API_KEY',
          description: 'Saidwire',
        })}`,
        ...options.headers,
      },
      `ai-sdk/saidwire/${VERSION}`,
    );

  const createTranscriptionModel = (modelId: SaidwireTranscriptionModelId) =>
    new SaidwireTranscriptionModel(modelId, {
      provider: 'saidwire.transcription',
      url: ({ path }) => `${baseURL}${path}`,
      headers: getHeaders,
      fetch: options.fetch,
    });

  const noSuchModel =
    (modelType: 'languageModel' | 'embeddingModel' | 'imageModel') =>
    (modelId: string): never => {
      throw new NoSuchModelError({ modelId, modelType });
    };

  const provider = function (modelId: SaidwireTranscriptionModelId) {
    if (new.target) {
      throw new Error('The Saidwire model function cannot be called with the new keyword.');
    }
    return createTranscriptionModel(modelId);
  };

  return Object.assign(provider, {
    specificationVersion: 'v4' as const,
    transcriptionModel: createTranscriptionModel,
    transcription: createTranscriptionModel,
    languageModel: noSuchModel('languageModel'),
    embeddingModel: noSuchModel('embeddingModel'),
    imageModel: noSuchModel('imageModel'),
  }) satisfies SaidwireProvider;
}

/** Default provider instance. Reads `SAIDWIRE_API_KEY`. */
export const saidwire = createSaidwire();
