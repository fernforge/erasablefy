export type ChangeKind = "enum" | "namespace" | "parameter-property";

export interface Change {
  kind: ChangeKind;
  name: string;
  line: number;
}

export interface Skip {
  kind: ChangeKind;
  name: string;
  line: number;
  /** Why this construct was left untouched. Reported so the user fixes it by hand. */
  reason: string;
}

export interface FileResult {
  changes: Change[];
  skips: Skip[];
}
