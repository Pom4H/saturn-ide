import { ShellClient } from './client';
/** Browser binding only; terminal imports ShellClient directly and never evaluates location. */
export let browserClient = new ShellClient(location.origin);
/** Hosts install a transport before mounting the same Shell. */
export function configureBrowserClient(client:ShellClient){browserClient=client;}
export const api = <T,>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => browserClient.request<T>(path, body, signal);
