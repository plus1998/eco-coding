export type ThreadIntent = "coding" | "question";

const codingPatterns = [
  /(^|\s)(add|build|change|create|delete|edit|fix|implement|refactor|remove|update|write)(\s|$)/i,
  /(实现|修改|修复|新增|添加|删除|移除|重构|开发|编写|接入|支持|完成|做一个|改成)/,
];

const questionPatterns = [
  /\?$/,
  /？$/,
  /^(what|why|how|when|where|which|can you explain|explain)\b/i,
  /^(什么|为什么|为何|怎么|怎样|如何|能否解释|解释一下|说明一下|介绍一下|请问)/,
  /^(状态|进展).*(怎么样|如何|到哪|到哪里|了吗|了么)/,
  /^(现在|目前).*(状态|进展)/,
  /(做完了吗|完成了吗|还在跑吗|还在执行吗)/,
];

export function classifyThreadIntent(prompt: string): ThreadIntent {
  const text = prompt.trim();
  if (!text) {
    return "coding";
  }

  const codingScore = scorePatterns(text, codingPatterns);
  const questionScore = scorePatterns(text, questionPatterns);

  if (codingScore > 0) {
    return "coding";
  }
  if (questionScore > 0) {
    return "question";
  }
  return "coding";
}

function scorePatterns(text: string, patterns: RegExp[]): number {
  return patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
}
