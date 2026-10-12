/** The API client. Errors arrive as sentences (PRD §81) and surface as ApiError.message. */
import { QueryClient } from '@tanstack/react-query';

export class ApiError extends Error {
  constructor(message: string, public status: number, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'x-acs': '1', ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      ...init,
    });
  } catch {
    throw new ApiError("Can't reach Creative Studio. Check your connection.", 0);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = (data ?? {}) as Record<string, unknown>;
    throw new ApiError(typeof d.error === 'string' ? d.error : 'Something went wrong. Try again.', res.status, d);
  }
  return data as T;
}

export const api = {
  get: <T,>(p: string) => request<T>('GET', p),
  post: <T,>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T,>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T,>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  del: <T,>(p: string) => request<T>('DELETE', p),
  upload: <T,>(p: string, file: File | Blob, fields: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.append('file', file, (file as File).name || 'pasted.png');
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return request<T>('POST', p, fd);
  },
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 },
  },
});
