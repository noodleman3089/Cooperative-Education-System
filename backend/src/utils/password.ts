import bcrypt from 'bcryptjs';

/**
 * There is deliberately no password generator here. Companies and mentors are
 * onboarded with an invitation link and choose their own password (see
 * `utils/invite.ts`); the system never mints a credential on a user's behalf.
 */

/**
 * Hashes a plaintext password using bcrypt.
 */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

/**
 * Compares a plaintext password with a bcrypt hash.
 */
export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};
