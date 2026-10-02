import { query } from '../config/database';
import { User } from '../types';

export const VALID_ROLES = ['student', 'advisor', 'dean', 'staff', 'dept_head', 'mentor'];

export class UserModel {
  /**
   * Find a user by email, fetching their roles as an array from the user_roles table.
   */
  static async findByEmail(email: string): Promise<User | null> {
    const res = await query(
      `SELECT u.user_id, u.email, u.password_hash, u.is_active, 
              COALESCE(json_agg(r.role_name) FILTER (WHERE r.role_name IS NOT NULL), '[]') as roles
       FROM users u
       LEFT JOIN user_roles r ON u.user_id = r.user_id
       WHERE u.email = $1
       GROUP BY u.user_id`,
      [email]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    
    const user = res.rows[0];
    return {
      user_id: user.user_id,
      email: user.email,
      password_hash: user.password_hash,
      is_active: user.is_active,
      roles: typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles,
    };
  }

  /**
   * Find a user by ID, fetching their roles as an array from the user_roles table.
   */
  static async findById(userId: number): Promise<User | null> {
    const res = await query(
      `SELECT u.user_id, u.email, u.password_hash, u.is_active, 
              COALESCE(json_agg(r.role_name) FILTER (WHERE r.role_name IS NOT NULL), '[]') as roles
       FROM users u
       LEFT JOIN user_roles r ON u.user_id = r.user_id
       WHERE u.user_id = $1
       GROUP BY u.user_id`,
      [userId]
    );
    if ((res.rowCount ?? 0) === 0) return null;

    const user = res.rows[0];
    return {
      user_id: user.user_id,
      email: user.email,
      password_hash: user.password_hash,
      is_active: user.is_active,
      roles: typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles,
    };
  }

  /**
   * Create a new user with an optional initial role.
   * passwordHash can be null to support SSO accounts.
   */
  static async createUser(email: string, passwordHash: string | null, role?: string): Promise<User> {
    const res = await query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id, email, is_active',
      [email, passwordHash]
    );
    const user = res.rows[0];
    const roles: string[] = [];

    if (role) {
      await this.addRole(user.user_id, role);
      roles.push(role);
    }

    return {
      user_id: user.user_id,
      email: user.email,
      password_hash: passwordHash,
      is_active: user.is_active,
      roles,
    };
  }

  /**
   * Add a role to a user.
   */
  static async addRole(userId: number, roleName: string): Promise<void> {
    if (!VALID_ROLES.includes(roleName)) {
      throw new Error(`Invalid role name: '${roleName}'. Allowed roles are: ${VALID_ROLES.join(', ')}`);
    }
    await query(
      'INSERT INTO user_roles (user_id, role_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, roleName]
    );
  }

  /**
   * Remove a role from a user.
   */
  static async removeRole(userId: number, roleName: string): Promise<void> {
    await query(
      'DELETE FROM user_roles WHERE user_id = $1 AND role_name = $2',
      [userId, roleName]
    );
  }

  /**
   * Clear all roles associated with a user.
   */
  static async clearRoles(userId: number): Promise<void> {
    await query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
  }

  /**
   * Update a user's status.
   */
  static async updateStatus(userId: number, isActive: boolean): Promise<boolean> {
    const res = await query(
      'UPDATE users SET is_active = $1 WHERE user_id = $2',
      [isActive, userId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Get all user accounts (passwords excluded), including their aggregated roles.
   */
  static async getAll(): Promise<Omit<User, 'password_hash'>[]> {
    const res = await query(
      `SELECT u.user_id, u.email, u.is_active, 
              COALESCE(json_agg(r.role_name) FILTER (WHERE r.role_name IS NOT NULL), '[]') as roles
       FROM users u
       LEFT JOIN user_roles r ON u.user_id = r.user_id
       GROUP BY u.user_id
       ORDER BY u.user_id DESC`
    );
    
    return res.rows.map((row) => ({
      user_id: row.user_id,
      email: row.email,
      is_active: row.is_active,
      roles: typeof row.roles === 'string' ? JSON.parse(row.roles) : row.roles,
    })) as Omit<User, 'password_hash'>[];
  }

  /**
   * Update a user's email, is_active status, and reset/assign new roles.
   */
  static async update(
    userId: number,
    email: string,
    roles: string[],
    isActive: boolean
  ): Promise<Omit<User, 'password_hash'> | null> {
    // Validate all roles before updating user
    for (const r of roles) {
      const trimmed = r.trim();
      if (trimmed && !VALID_ROLES.includes(trimmed)) {
        throw new Error(`Invalid role name: '${trimmed}'. Allowed roles are: ${VALID_ROLES.join(', ')}`);
      }
    }

    const res = await query(
      'UPDATE users SET email = $1, is_active = $2 WHERE user_id = $3 RETURNING user_id, email, is_active',
      [email, isActive, userId]
    );
    if ((res.rowCount ?? 0) === 0) return null;

    // Reset and add new roles list
    await this.clearRoles(userId);
    for (const role of roles) {
      const trimmedRole = role.trim();
      if (trimmedRole) {
        await this.addRole(userId, trimmedRole);
      }
    }

    return {
      user_id: userId,
      email,
      is_active: isActive,
      roles,
    };
  }

  /**
   * Delete a user account (foreign keys cascade to role and profile tables).
   */
  static async delete(userId: number): Promise<boolean> {
    const res = await query('DELETE FROM users WHERE user_id = $1', [userId]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Update a user's password hash.
   */
  static async updatePassword(userId: number, passwordHash: string): Promise<boolean> {
    const res = await query(
      'UPDATE users SET password_hash = $1 WHERE user_id = $2',
      [passwordHash, userId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Save a password reset token with expiry timestamp for a user.
   */
  static async saveResetToken(userId: number, token: string, expiresAt: Date): Promise<void> {
    await query(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE user_id = $3',
      [token, expiresAt, userId]
    );
  }

  /**
   * Find a user by a valid (non-expired) reset token.
   */
  static async findByResetToken(token: string): Promise<User | null> {
    const res = await query(
      `SELECT u.user_id, u.email, u.password_hash, u.is_active,
              COALESCE(json_agg(r.role_name) FILTER (WHERE r.role_name IS NOT NULL), '[]') as roles
       FROM users u
       LEFT JOIN user_roles r ON u.user_id = r.user_id
       WHERE u.reset_token = $1 AND u.reset_token_expires > NOW()
       GROUP BY u.user_id`,
      [token]
    );
    if ((res.rowCount ?? 0) === 0) return null;

    const user = res.rows[0];
    return {
      user_id: user.user_id,
      email: user.email,
      password_hash: user.password_hash,
      is_active: user.is_active,
      roles: typeof user.roles === 'string' ? JSON.parse(user.roles) : user.roles,
    };
  }

  /**
   * Clear the reset token after a successful password reset.
   */
  static async clearResetToken(userId: number): Promise<void> {
    await query(
      'UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE user_id = $1',
      [userId]
    );
  }
}
