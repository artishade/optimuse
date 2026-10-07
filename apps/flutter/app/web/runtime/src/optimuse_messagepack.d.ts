/** Provides the MessagePack API used by the generated worker module. */
export interface OptimuseMessagePack {
  encode(value: unknown): Uint8Array;
  decode(bytes: Uint8Array): unknown;
}

export const MessagePack: OptimuseMessagePack;
