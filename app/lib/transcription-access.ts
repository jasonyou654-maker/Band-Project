import { getChatGPTUser } from "@/app/chatgpt-auth";

export type PrivateTranscriptionUser = { email: string; isAdmin: boolean };

function configuredAdministrators(): Set<string> {
  return new Set((process.env.TRANSCRIPTION_ADMIN_EMAILS || "").split(",").map(email => email.trim().toLowerCase()).filter(Boolean));
}

export async function requirePrivateTranscriptionUser(): Promise<PrivateTranscriptionUser> {
  const user = await getChatGPTUser();
  if (!user) throw new Response("Sign in is required to use private transcription.", { status: 401 });
  const email = user.email.toLowerCase();
  return { email, isAdmin: configuredAdministrators().has(email) };
}

export function canAccessOwner(user: PrivateTranscriptionUser, ownerEmail: string): boolean {
  return user.isAdmin || user.email === ownerEmail.toLowerCase();
}
