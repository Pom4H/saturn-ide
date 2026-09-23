import { ShellClient } from './client';
/** Browser binding only; terminal imports ShellClient directly and never evaluates location. */
export const browserClient = new ShellClient(location.origin);
export const api = <T,>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => browserClient.request<T>(path, body, signal);
