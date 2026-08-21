import "dotenv/config";

export const env = {
  notionToken: process.env.NOTION_TOKEN ?? "",
  port: Number(process.env.PORT ?? 3000),
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  runLogEnabled: process.env.RUN_LOG_ENABLED !== "false",

  llmApiKey: process.env.LLM_API_KEY ?? "",
  llmBaseUrl: process.env.LLM_BASE_URL ?? "https://api.groq.com/openai/v1",
  llmModel: process.env.LLM_MODEL ?? "openai/gpt-oss-120b",
  whisperModel: process.env.WHISPER_MODEL ?? "whisper-large-v3",

  resendApiKey: process.env.RESEND_API_KEY ?? "",
  resendApiUrl: process.env.RESEND_API_URL ?? "https://api.resend.com/emails",
  emailFrom: process.env.EMAIL_FROM ?? "Tiffin Butler <onboarding@resend.dev>",
  emailTo: process.env.EMAIL_TO ?? "thakur71039@gmail.com",
  emailDelivery: (process.env.EMAIL_DELIVERY ?? "sandbox") === "customer" ? "customer" : "sandbox",

  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  whatsappGraphUrl: process.env.WHATSAPP_GRAPH_URL ?? "https://graph.facebook.com/v21.0",
  whatsappReplies: process.env.WHATSAPP_REPLIES === "true",
};
