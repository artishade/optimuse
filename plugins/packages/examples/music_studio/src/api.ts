/** Self-contained client. Requires com.optimuse.music_studio >=0.1.0 in manifest.requires. */
export interface MusicRequest { action: string; [key: string]: unknown }
export function request<T = unknown>(payload: MusicRequest): Promise<T> { return ToolPkg.callDependency<MusicRequest, T>("com.optimuse.music_studio", "request", payload); }
