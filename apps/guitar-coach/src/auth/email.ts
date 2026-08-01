interface AuthEmailParams {
  user: { email: string };
  url: string;
  token: string;
}

export function sendVerificationEmail({
  user,
  url,
}: AuthEmailParams): Promise<void> {
  console.log(`[auth] verification email for ${user.email}: ${url}`);
  return Promise.resolve();
}

export function sendResetPasswordEmail({
  user,
  url,
}: AuthEmailParams): Promise<void> {
  console.log(`[auth] password reset email for ${user.email}: ${url}`);
  return Promise.resolve();
}
