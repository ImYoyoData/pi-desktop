/** Rows shown in the "fetch models from provider" picker. */

export type PickerModel = {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
};

/** A picker row after user edits (limits are editable per row). */
export type PickerRow = {
  id: string;
  name: string;
  contextWindow: number | null;
  maxTokens: number | null;
  reasoning: boolean;
  vision: boolean;
  selected: boolean;
};
