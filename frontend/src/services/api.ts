export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

/**
 * ตัว body ที่ส่งเข้ามาเป็นอะไรก็ได้ที่ JSON.stringify รับได้ หรือเป็น FormData
 * (สำหรับการอัปโหลดไฟล์) — `unknown` บังคับให้ผู้เรียกไม่เผลอพึ่งพารูปร่างของมัน
 */
type RequestBody = unknown;

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: RequestBody;
}

/** รูปร่างของ error ที่ ApiClient โยนออกไป — `utils/errors.ts` อ่านมันด้วยรูปนี้ */
interface ApiError extends Error {
  response?: {
    status: number;
    data: { message?: string };
  };
}

class ApiClient {
  private async request(path: string, options: RequestOptions = {}) {
    const url = `${API_BASE_URL}${path}`;
    
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    // The session is an httpOnly cookie the browser attaches on its own; there
    // is no token for JS to read or forward.
    const { body: _rawBody, ...fetchOptions } = options;
    const config: RequestInit = {
      ...fetchOptions,
      headers,
      credentials: 'include',
    };

    if (options.body) {
      if (options.body instanceof FormData) {
        config.body = options.body;
      } else {
        config.body = JSON.stringify(options.body);
      }
    }

    const response = await fetch(url, config);

    if (response.status === 401) {
      if (!path.startsWith('/auth/')) {
        localStorage.removeItem('auth_user');
        window.dispatchEvent(new Event('auth:unauthorized'));
        throw new Error('Unauthorized');
      }
    }

    if (!response.ok) {
      let errorData: { message?: string } | undefined;
      try {
        errorData = await response.json();
      } catch {
        // Ignore parse failure
      }
      const err: ApiError = new Error(errorData?.message || 'An error occurred');
      err.response = {
        status: response.status,
        data: errorData || { message: 'An error occurred' },
      };
      throw err;
    }

    if (response.status === 204) {
      return null;
    }

    return await response.json();
  }

  get(path: string, options?: RequestOptions) {
    return this.request(path, { ...options, method: 'GET' });
  }

  post(path: string, body?: RequestBody, options?: RequestOptions) {
    return this.request(path, { ...options, method: 'POST', body });
  }

  put(path: string, body?: RequestBody, options?: RequestOptions) {
    return this.request(path, { ...options, method: 'PUT', body });
  }

  patch(path: string, body?: RequestBody, options?: RequestOptions) {
    return this.request(path, { ...options, method: 'PATCH', body });
  }

  delete(path: string, options?: RequestOptions) {
    return this.request(path, { ...options, method: 'DELETE' });
  }
}

const api = new ApiClient();
export default api;
