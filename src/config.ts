import "dotenv/config";

export const env = {
  notionToken: process.env.NOTION_TOKEN ?? "",
  port: Number(process.env.PORT ?? 3000),
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  runLogEnabled: process.env.RUN_LOG_ENABLED !== "false",

  llmApiKey: process.env.LLM_API_KEY ?? "",
  llmBaseUrl: process.env.LLM_BASE_URL ?? "https://api.groq.com/openai/v1",
  llmModel: process.env.LLM_MODEL ?? "openai/gpt-oss-120b",

  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "Tiffin Butler <onboarding@resend.dev>",
};
