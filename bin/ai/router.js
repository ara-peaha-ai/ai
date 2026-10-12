// Model ids "<prefix>/<model>" whose prefix is listed here skip the Vercel AI Gateway and go
// straight to that OpenAI-compatible endpoint; every other id goes through the Gateway
// (AI_GATEWAY_API_KEY). Same routing as the vercel-ai app; keys are read at call time.
const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
const { gateway } = require('ai');

const getLanguageModel = (modelId) => {
  const [prefix, ...rest] = modelId.split('/');
  const direct = {
    'deepseek-direct': { apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' },
    nvidia: { apiKey: process.env.NVIDIA_API_KEY, baseURL: 'https://integrate.api.nvidia.com/v1' },
  }[prefix];
  return direct ? createOpenAICompatible({ ...direct, name: prefix })(rest.join('/')) : gateway(modelId);
};

module.exports = { getLanguageModel };
