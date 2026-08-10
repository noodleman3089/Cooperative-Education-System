export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

interface RequestOptions extends RequestInit {
  body?: any;
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
    const config: RequestInit = {
      ...options,
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

    try {
      const response = await fetch(url, config);

      if (response.status === 401) {
        if (!path.startsWith('/auth/')) {
          localStorage.removeItem('auth_user');
          window.dispatchEvent(new Event('auth:unauthorized'));
          throw new Error('Unauthorized');
        }
      }

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          // Ignore parse failure
        }
        const err = new Error(errorData?.message || 'An error occurred');
        (err as any).response = {
          status: response.status,
          data: errorData || { message: 'An error occurred' }
        };
        throw err;
      }

      if (response.status === 204) {
        return null;
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  }

  get(path: string, options?: RequestOptions) {
    return this.request(path, { ...options, method: 'GET' });
  }

  post(path: string, body?: any, options?: RequestOptions) {
    return this.request(path, { ...options, method: 'POST', body });
  }

  put(path: string, body?: any, options?: RequestOptions) {
    return this.request(path, { ...options, method: 'PUT', body });
  }

  patch(path: string, body?: any, options?: RequestOptions) {
    return this.request(path, { ...options, method: 'PATCH', body });
  }

  delete(path: string, options?: RequestOptions) {
    return this.request(path, { ...options, method: 'DELETE' });
  }
}

const api = new ApiClient();
export default api;
