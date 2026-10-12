import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { customProvider, gateway } from "ai";
import { isTestEnvironment } from "../constants";
import { titleModel } from "./models";

// Model ids "<prefix>/<model>" whose prefix is listed here skip the Vercel AI
// Gateway and go straight to that OpenAI-compatible endpoint.
const directProviders = {
  "deepseek-direct": createOpenAICompatible({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com",
    name: "deepseek-direct",
  }),
  nvidia: createOpenAICompatible({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: "https://integrate.api.nvidia.com/v1",
    name: "nvidia",
  }),
};

function routeModel(modelId: string) {
  const [prefix, ...rest] = modelId.split("/");
  const direct = directProviders[prefix as keyof typeof directProviders];
  return direct ? direct(rest.join("/")) : gateway.languageModel(modelId);
}

export const myProvider = isTestEnvironment
  ? (() => {
      const {
        chatModel,
        titleModel: mockTitleModel,
      } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "title-model": mockTitleModel,
        },
      });
    })()
  : null;

export function getLanguageModel(modelId: string) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(modelId);
  }

  return routeModel(modelId);
}

export function getTitleModel() {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }
  return routeModel(titleModel.id);
}
