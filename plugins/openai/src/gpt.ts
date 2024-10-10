/**
 * Copyright 2024 The Fire Company
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Message } from '@genkit-ai/ai';
import {
  GenerateResponseChunkData,
  GenerateResponseData,
  GenerationCommonConfigSchema,
  ModelAction,
  defineModel,
  modelRef,
  type CandidateData,
  type GenerateRequest,
  type MessageData,
  type Part,
  type Role,
  type ToolDefinition,
  type ToolRequestPart,
} from '@genkit-ai/ai/model';
import { StreamingCallback } from '@genkit-ai/core';
import OpenAI from 'openai';
import {
  type ChatCompletion,
  type ChatCompletionChunk,
  type ChatCompletionContentPart,
  type ChatCompletionCreateParamsNonStreaming,
  type ChatCompletionMessageParam,
  type ChatCompletionMessageToolCall,
  type ChatCompletionRole,
  type ChatCompletionTool,
  type CompletionChoice,
} from 'openai/resources/index.mjs';
import z from 'zod';

const MODELS_SUPPORTING_OPENAI_RESPONSE_FORMAT = [
  'gpt-4o',
  'gpt-4o-2024-05-13',
  'gpt-4o-mini',
  'gpt-4o-mini-2024-07-18',
  'gpt-4-turbo',
  'gpt-4-turbo-2024-04-09',
  'gpt-4-turbo-preview',
  'gpt-4-0125-preview',
  'gpt-4-1106-preview',
  'gpt-3.5-turbo-0125',
  'gpt-3.5-turbo',
  'gpt-3.5-turbo-1106',
];

export const OpenAiConfigSchema = GenerationCommonConfigSchema.extend({
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  logitBias: z.record(z.string(), z.number().min(-100).max(100)).optional(),
  logProbs: z.boolean().optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  seed: z.number().int().optional(),
  topLogProbs: z.number().int().min(0).max(20).optional(),
  user: z.string().optional(),
  visualDetailLevel: z.enum(['auto', 'low', 'high']).optional(),
});

type VisualDetailLevel = z.infer<
  typeof OpenAiConfigSchema
>['visualDetailLevel'];

export const gpt4o = modelRef({
  name: 'openai/gpt-4o',
  info: {
    versions: ['gpt-4o', 'gpt-4o-2024-05-13'],
    label: 'OpenAI - GPT-4o',
    supports: {
      multiturn: true,
      tools: true,
      media: true,
      systemRole: true,
      output: ['text', 'json'],
    },
  },
  configSchema: OpenAiConfigSchema,
});

export const gpt4oMini = modelRef({
  name: 'openai/gpt-4o-mini',
  info: {
    versions: ['gpt-4o-mini', 'gpt-4o-mini-2024-07-18'],
    label: 'OpenAI - GPT-4o mini',
    supports: {
      multiturn: true,
      tools: true,
      media: true,
      systemRole: true,
      output: ['text', 'json'],
    },
  },
  configSchema: OpenAiConfigSchema,
});

export const gpt4Turbo = modelRef({
  name: 'openai/gpt-4-turbo',
  info: {
    versions: [
      'gpt-4-turbo',
      'gpt-4-turbo-2024-04-09',
      'gpt-4-turbo-preview',
      'gpt-4-0125-preview',
      'gpt-4-1106-preview',
    ],
    label: 'OpenAI - GPT-4 Turbo',
    supports: {
      multiturn: true,
      tools: true,
      media: true,
      systemRole: true,
      output: ['text', 'json'],
    },
  },
  configSchema: OpenAiConfigSchema,
});

export const gpt4Vision = modelRef({
  name: 'openai/gpt-4-vision',
  info: {
    versions: ['gpt-4-vision-preview', 'gpt-4-1106-vision-preview'],
    label: 'OpenAI - GPT-4 Vision',
    supports: {
      multiturn: true,
      tools: false,
      media: true,
      systemRole: true,
      output: ['text'],
    },
  },
  configSchema: OpenAiConfigSchema,
});

export const gpt4 = modelRef({
  name: 'openai/gpt-4',
  info: {
    versions: ['gpt-4', 'gpt-4-0613', 'gpt-4-32k', 'gpt-4-32k-0613'],
    label: 'OpenAI - GPT-4',
    supports: {
      multiturn: true,
      tools: true,
      media: false,
      systemRole: true,
      output: ['text'],
    },
  },
  configSchema: OpenAiConfigSchema,
});

export const gpt35Turbo = modelRef({
  name: 'openai/gpt-3.5-turbo',
  info: {
    versions: ['gpt-3.5-turbo-0125', 'gpt-3.5-turbo', 'gpt-3.5-turbo-1106'],
    label: 'OpenAI - GPT-3.5 Turbo',
    supports: {
      multiturn: true,
      tools: true,
      media: false,
      systemRole: true,
      output: ['json', 'text'],
    },
  },
  configSchema: OpenAiConfigSchema,
});

export const SUPPORTED_GPT_MODELS = {
  'gpt-4o': gpt4o,
  'gpt-4o-mini': gpt4oMini,
  'gpt-4-turbo': gpt4Turbo,
  'gpt-4-vision': gpt4Vision,
  'gpt-4': gpt4,
  'gpt-3.5-turbo': gpt35Turbo,
};

export function toOpenAIRole(role: Role): ChatCompletionRole {
  switch (role) {
    case 'user':
      return 'user';
    case 'model':
      return 'assistant';
    case 'system':
      return 'system';
    case 'tool':
      return 'tool';
    default:
      throw new Error(`role ${role} doesn't map to an OpenAI role.`);
  }
}

/**
 * Converts a Genkit ToolDefinition to an OpenAI ChatCompletionTool object.
 * @param tool The Genkit ToolDefinition to convert.
 * @returns The converted OpenAI ChatCompletionTool object.
 */
function toOpenAiTool(tool: ToolDefinition): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      parameters: tool.inputSchema,
    },
  };
}

/**
 * Converts a Genkit Part to the corresponding OpenAI ChatCompletionContentPart.
 * @param part The Genkit Part to convert.
 * @param visualDetailLevel The visual detail level to use for media parts.
 * @returns The corresponding OpenAI ChatCompletionContentPart.
 * @throws Error if the part contains unsupported fields for the current message role.
 */
export function toOpenAiTextAndMedia(
  part: Part,
  visualDetailLevel: VisualDetailLevel
): ChatCompletionContentPart {
  if (part.text) {
    return {
      type: 'text',
      text: part.text,
    };
  } else if (part.media) {
    return {
      type: 'image_url',
      image_url: {
        url: part.media.url,
        detail: visualDetailLevel,
      },
    };
  }
  throw Error(
    `Unsupported genkit part fields encountered for current message role: ${JSON.stringify(part)}.`
  );
}

/**
 * Converts a Genkit MessageData array to an OpenAI ChatCompletionMessageParam array.
 * @param messages The Genkit MessageData array to convert.
 * @param visualDetailLevel The visual detail level to use for media parts.
 * @returns The converted OpenAI ChatCompletionMessageParam array.
 */
export function toOpenAiMessages(
  messages: MessageData[],
  visualDetailLevel: VisualDetailLevel = 'auto'
): ChatCompletionMessageParam[] {
  const openAiMsgs: ChatCompletionMessageParam[] = [];
  for (const message of messages) {
    const msg = new Message(message);
    const role = toOpenAIRole(message.role);
    switch (role) {
      case 'user':
        openAiMsgs.push({
          role: role,
          content: msg.content.map((part) =>
            toOpenAiTextAndMedia(part, visualDetailLevel)
          ),
        });
        break;
      case 'system':
        openAiMsgs.push({
          role: role,
          content: msg.text(),
        });
        break;
      case 'assistant': {
        const toolCalls: ChatCompletionMessageToolCall[] = msg.content
          .filter(
            (
              part
            ): part is Part & {
              toolRequest: NonNullable<Part['toolRequest']>;
            } => Boolean(part.toolRequest)
          )
          .map((part) => ({
            id: part.toolRequest.ref ?? '',
            type: 'function',
            function: {
              name: part.toolRequest.name,
              arguments: JSON.stringify(part.toolRequest.input),
            },
          }));
        if (toolCalls.length > 0) {
          openAiMsgs.push({
            role: role,
            tool_calls: toolCalls,
          });
        } else {
          openAiMsgs.push({
            role: role,
            content: msg.text(),
          });
        }
        break;
      }
      case 'tool': {
        const toolResponseParts = msg.toolResponseParts();
        toolResponseParts.map((part) => {
          openAiMsgs.push({
            role: role,
            tool_call_id: part.toolResponse.ref ?? '',
            content:
              typeof part.toolResponse.output === 'string'
                ? part.toolResponse.output
                : JSON.stringify(part.toolResponse.output),
          });
        });
        break;
      }
    }
  }
  return openAiMsgs;
}

const finishReasonMap: Record<
  // OpenAI Node SDK doesn't support tool_call in the enum, but it is returned from the API
  CompletionChoice['finish_reason'] | 'tool_calls',
  CandidateData['finishReason']
> = {
  length: 'length',
  stop: 'stop',
  tool_calls: 'stop',
  content_filter: 'blocked',
};

/**
 * Converts an OpenAI tool call to a Genkit ToolRequestPart.
 * @param toolCall The OpenAI tool call to convert.
 * @returns The converted Genkit ToolRequestPart.
 */
export function fromOpenAiToolCall(
  toolCall:
    | ChatCompletionMessageToolCall
    | ChatCompletionChunk.Choice.Delta.ToolCall
): ToolRequestPart {
  if (!toolCall.function) {
    throw Error(
      `Unexpected openAI chunk choice. tool_calls was provided but one or more tool_calls is missing.`
    );
  }
  const f = toolCall.function;

  let args;
  try {
    args = f.arguments ? JSON.parse(f.arguments) : f.arguments;
  } catch (e) {
    args = f.arguments;
  }
  return {
    toolRequest: {
      name: f.name!,
      ref: toolCall.id,
      input: args,
    },
  };
}

/**
 * Converts an OpenAI message event to a Genkit CandidateData object.
 * @param choice The OpenAI message event to convert.
 * @param jsonMode Whether the event is a JSON response.
 * @returns The converted Genkit CandidateData object.
 */
export function fromOpenAiChoice(
  choice: ChatCompletion.Choice,
  jsonMode = false
): CandidateData {
  const toolRequestParts = choice.message.tool_calls?.map(fromOpenAiToolCall);
  return {
    index: choice.index,
    finishReason: finishReasonMap[choice.finish_reason] || 'other',
    message: {
      role: 'model',
      content:
        toolRequestParts && toolRequestParts.length > 0
          ? // Note: Not sure why I have to cast here exactly.
            // Otherwise it thinks toolRequest must be 'undefined' if provided
            (toolRequestParts as ToolRequestPart[])
          : [
              jsonMode
                ? { data: JSON.parse(choice.message.content!) }
                : { text: choice.message.content! },
            ],
    },
    custom: {},
  };
}

/**
 * Converts an OpenAI message stream event to a Genkit CandidateData object.
 * @param choice The OpenAI message stream event to convert.
 * @param jsonMode Whether the event is a JSON response.
 * @returns The converted Genkit CandidateData object.
 */
export function fromOpenAiChunkChoice(
  choice: ChatCompletionChunk.Choice,
  jsonMode = false
): CandidateData {
  const toolRequestParts = choice.delta.tool_calls?.map(fromOpenAiToolCall);
  return {
    index: choice.index,
    finishReason: choice.finish_reason
      ? finishReasonMap[choice.finish_reason] || 'other'
      : 'unknown',
    message: {
      role: 'model',
      content: toolRequestParts
        ? // Note: Not sure why I have to cast here exactly.
          // Otherwise it thinks toolRequest must be 'undefined' if provided
          (toolRequestParts as ToolRequestPart[])
        : [
            jsonMode
              ? { data: JSON.parse(choice.delta.content!) }
              : { text: choice.delta.content! },
          ],
    },
    custom: {},
  };
}

/**
 * Converts an OpenAI request to an OpenAI API request body.
 * @param modelName The name of the OpenAI model to use.
 * @param request The Genkit GenerateRequest to convert.
 * @returns The converted OpenAI API request body.
 * @throws An error if the specified model is not supported or if an unsupported output format is requested.
 */
export function toOpenAiRequestBody(
  modelName: string,
  request: GenerateRequest<typeof OpenAiConfigSchema>
) {
  const model = SUPPORTED_GPT_MODELS[modelName];
  if (!model) throw new Error(`Unsupported model: ${modelName}`);
  const openAiMessages = toOpenAiMessages(
    request.messages,
    request.config?.visualDetailLevel
  );
  const mappedModelName = request.config?.version || model.version || modelName;
  const body = {
    model: mappedModelName,
    messages: openAiMessages,
    temperature: request.config?.temperature,
    max_tokens: request.config?.maxOutputTokens,
    top_p: request.config?.topP,
    stop: request.config?.stopSequences,
    frequency_penalty: request.config?.frequencyPenalty,
    logit_bias: request.config?.logitBias,
    logprobs: request.config?.logProbs, // logprobs not snake case!
    presence_penalty: request.config?.presencePenalty,
    seed: request.config?.seed,
    top_logprobs: request.config?.topLogProbs, // logprobs not snake case!
    user: request.config?.user,
    tools: request.tools?.map(toOpenAiTool),
    n: request.candidates,
  } as ChatCompletionCreateParamsNonStreaming;

  const response_format = request.output?.format;
  if (
    response_format &&
    MODELS_SUPPORTING_OPENAI_RESPONSE_FORMAT.includes(mappedModelName)
  ) {
    if (
      response_format === 'json' &&
      model.info.supports?.output?.includes('json')
    ) {
      body.response_format = {
        type: 'json_object',
      };
    } else if (
      response_format === 'text' &&
      model.info.supports?.output?.includes('text')
    ) {
      body.response_format = {
        type: 'text',
      };
    } else {
      throw new Error(
        `${response_format} format is not supported for GPT models currently`
      );
    }
  }
  for (const key in body) {
    if (!body[key] || (Array.isArray(body[key]) && !body[key].length))
      delete body[key];
  }
  return body;
}

/**
 * Creates the runner used by Genkit to interact with the GPT model.
 * @param name The name of the GPT model.
 * @param client The OpenAI client instance.
 * @returns The runner that Genkit will call when the model is invoked.
 */
export function gptRunner(name: string, client: OpenAI) {
  return async (
    request: GenerateRequest<typeof OpenAiConfigSchema>,
    streamingCallback?: StreamingCallback<GenerateResponseChunkData>
  ): Promise<GenerateResponseData> => {
    let response: ChatCompletion;
    const body = toOpenAiRequestBody(name, request);
    if (streamingCallback) {
      const stream = client.beta.chat.completions.stream({
        ...body,
        stream: true,
      });
      for await (const chunk of stream) {
        chunk.choices?.forEach((chunk) => {
          const c = fromOpenAiChunkChoice(chunk);
          streamingCallback({
            index: c.index,
            content: c.message.content,
          });
        });
      }
      response = await stream.finalChatCompletion();
    } else {
      response = await client.chat.completions.create(body);
    }
    return {
      candidates: response.choices.map((c) =>
        fromOpenAiChoice(c, request.output?.format === 'json')
      ),
      usage: {
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
      },
      custom: response,
    };
  };
}

/**
 * Defines a GPT model with the given name and OpenAI client.
 * @param name The name of the GPT model.
 * @param client The OpenAI client instance.
 * @returns The defined GPT model.
 * @throws An error if the specified model is not supported.
 */
export function gptModel(
  name: string,
  client: OpenAI
): ModelAction<typeof OpenAiConfigSchema> {
  const modelId = `openai/${name}`;
  const model = SUPPORTED_GPT_MODELS[name];
  if (!model) throw new Error(`Unsupported model: ${name}`);

  return defineModel(
    {
      name: modelId,
      ...model.info,
      configSchema: model.configSchema,
    },
    gptRunner(name, client)
  );
}
