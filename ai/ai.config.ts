/// <reference types="node" />
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

export function getAgentModel () {
    const provider = createOpenRouter({
      apiKey: process.env.YOUR_OPENROUTER_API_KEY || ''
    });

    const model = process.env.OPENROUTER_DEFAULT_MODEL || 'openrouter/free';

    return provider(model);
}