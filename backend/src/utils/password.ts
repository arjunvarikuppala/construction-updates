/**
 * Password policy for new passwords (registration, invitations, provisioning).
 * Existing users with older, shorter passwords can still sign in.
 */
export const PASSWORD_MIN_LENGTH = 8;

export function validatePasswordStrength(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) return 'Password is required';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;
  }
  if (password.length > 128) return 'Password must be at most 128 characters long';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain at least one letter and one number';
  }
  return null;
}
