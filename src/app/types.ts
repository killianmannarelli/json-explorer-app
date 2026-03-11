export type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
export type JSONObject = { [key: string]: JSONValue };
export type JSONArray = JSONValue[];
export type JsonType = "string" | "number" | "boolean" | "null" | "object" | "array";
export type Path = (string | number)[];

export type Segment = {
  type: "key" | "array";
  key: string;
};

export interface FieldSelection {
  fieldName: string;
  rawPath: Path;
}

export interface MessageState {
  type: "success" | "error";
  text: string;
}
