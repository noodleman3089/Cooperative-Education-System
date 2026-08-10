import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../types';
import { UserModel } from '../models/user';
import { AUTH_COOKIE } from '../utils/authCookie';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not configured.');
  process.exit(1);
}


/**
 * Middleware to authenticate the request using JWT.
 * Verifies the token and attaches the decoded user context to req.user.
 */
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // The session lives in an httpOnly cookie. It is never read from the query
  // string: a token in the URL leaks into access logs, browser history and the
  // Referer header of every outbound link.
  const token = req.cookies?.[AUTH_COOKIE];

  if (!token) {
    res.status(401).json({ message: 'Access token is missing. Please log in.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    
    // Check database to ensure user exists and is active
    const user = await UserModel.findById(decoded.userId);
    if (!user) {
      res.status(401).json({ message: 'User account not found.' });
      return;
    }

    if (!user.is_active) {
      res.status(403).json({ message: 'Your account has been deactivated.' });
      return;
    }

    // Attach decoded user info (including roles array) to request object
    req.user = {
      userId: user.user_id,
      email: user.email,
      roles: user.roles,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ message: 'Session expired. Please log in again.' });
      return;
    }
    res.status(403).json({ message: 'Invalid token.' });
    return;
  }
};

/**
 * Middleware to authorize access based on multiple user roles.
 * Checks if the user's role array contains at least one of the allowed roles.
 * Must be placed AFTER authenticateToken.
 */
export const authorizeRoles = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized. Authentication required.' });
      return;
    }

    const userRoles = req.user.roles || [];
    const isAuthorized = userRoles.some((role) => allowedRoles.includes(role));

    if (!isAuthorized) {
      res.status(403).json({
        message: 'Forbidden. You do not have access to this resource.',
      });
      return;
    }

    next();
  };
};
