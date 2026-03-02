import type { FlowlaneConfig } from '../../types';

export interface IConfigService {
  /** Read one config field. */
  get<T = unknown>(key: keyof FlowlaneConfig): T | undefined;
  /** Read the full config object. */
  getAll(): Partial<FlowlaneConfig>;
  /** Persist a single key → value pair. */
  set(key: keyof FlowlaneConfig, value: string): Promise<void>;
  /** Returns true when the config file exists on disk. */
  exists(): boolean;
  /** Checks all required fields are present. */
  validate(): { valid: boolean; missing: string[] };
}
