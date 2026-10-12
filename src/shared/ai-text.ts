export type TextRequest = {
  kind: 'translate' | 'compose';
  text: string;
  language?: 'zh-CN' | 'en';
  context?: string;
  ideas?: string[];
};
export type TextResult = { text: string; choices: string[] };
