export const officialModelUrl = 'https://shell.canp.ai/api/v1/models/chat/completions';
export const officialModels = [
  {
    id: 'b3ec7d42-7c04-4ee0-8b01-e67064082f10',
    name: 'Qwen3 8B · 免费',
    model: 'canp-qwen3-8b',
    url: officialModelUrl,
    key: '',
  },
  {
    id: 'f3bd9fe9-b107-461d-929d-26de37b5efb1',
    name: 'Qwen3.5 4B 视觉 · 免费',
    model: 'canp-qwen35-4b',
    url: officialModelUrl,
    key: '',
  },
];
export const isOfficialModel = (url: string, model: string) =>
  url === officialModelUrl && officialModels.some((p) => p.model === model);
