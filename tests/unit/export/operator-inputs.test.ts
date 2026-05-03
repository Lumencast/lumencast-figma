import { describe, it, expect } from "vitest";
import { extractOperatorInputs } from "../../../src/export/operator-inputs";
import { equipTree, type MockSceneNode } from "../../fixtures/figma/mock";

function operatorInput(
  id: string,
  data: Record<string, string>,
  asInstance = false,
): MockSceneNode {
  const base = {
    type: asInstance ? ("INSTANCE" as const) : ("COMPONENT" as const),
    id,
    name: "OperatorInput",
    width: 200,
    height: 40,
    children: [],
    pluginData: { ...data },
    ...(asInstance && {
      mainComponent: {
        type: "COMPONENT",
        id: "main",
        name: "OperatorInput",
        width: 200,
        height: 40,
        children: [],
      },
    }),
  };
  return base as unknown as MockSceneNode;
}

describe("extractOperatorInputs", () => {
  it("ignores non-OperatorInput components", () => {
    const root = equipTree({
      type: "FRAME",
      id: "f:0",
      name: "Root",
      width: 100,
      height: 100,
      children: [
        equipTree({
          type: "COMPONENT",
          id: "c:1",
          name: "Card",
          width: 100,
          height: 100,
          children: [],
        } as MockSceneNode),
      ],
    } as MockSceneNode);
    const r = extractOperatorInputs(root);
    expect(r.inputs).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it("extracts a string input with maxLength constraint", () => {
    const root = equipTree({
      type: "FRAME",
      id: "f:0",
      name: "Root",
      width: 100,
      height: 100,
      children: [
        equipTree(
          operatorInput("oi:1", {
            "operator_input.path": "__inputs.show_title",
            "operator_input.type": "string",
            "operator_input.label": "Show title",
            "operator_input.constraints": '{"maxLength":80}',
          }),
        ),
      ],
    } as MockSceneNode);
    const r = extractOperatorInputs(root);
    expect(r.inputs).toEqual([
      {
        path: "__inputs.show_title",
        type: "string",
        label: "Show title",
        constraints: { maxLength: 80 },
        writable_by: ["operator"],
      },
    ]);
  });

  it("supports the 9 LSML 1.1 types", () => {
    const types = [
      "string",
      "number",
      "boolean",
      "enum",
      "color",
      "date",
      "time",
      "path-ref",
      "image-ref",
    ];
    const children = types.map((t, i) =>
      equipTree(
        operatorInput(`oi:${i}`, {
          "operator_input.path": `__inputs.field_${i}`,
          "operator_input.type": t,
          ...(t === "enum" && {
            "operator_input.constraints": '{"values":["a","b"]}',
          }),
        }),
      ),
    );
    const root = equipTree({
      type: "FRAME",
      id: "f:0",
      name: "Root",
      width: 100,
      height: 100,
      children,
    } as MockSceneNode);
    const r = extractOperatorInputs(root);
    expect(r.inputs).toHaveLength(9);
    expect(r.inputs.map((i) => i.type)).toEqual(types);
    expect(r.warnings).toHaveLength(0);
  });

  it("rejects paths missing the __inputs. prefix", () => {
    const root = equipTree({
      type: "FRAME",
      id: "f:0",
      name: "Root",
      width: 100,
      height: 100,
      children: [
        equipTree(
          operatorInput("oi:bad", {
            "operator_input.path": "show.title",
            "operator_input.type": "string",
          }),
        ),
      ],
    } as MockSceneNode);
    const r = extractOperatorInputs(root);
    expect(r.inputs).toHaveLength(0);
    expect(r.warnings[0]?.message).toContain('must start with "__inputs."');
  });

  it("rejects unknown constraint keys for the declared type", () => {
    const root = equipTree({
      type: "FRAME",
      id: "f:0",
      name: "Root",
      width: 100,
      height: 100,
      children: [
        equipTree(
          operatorInput("oi:1", {
            "operator_input.path": "__inputs.color",
            "operator_input.type": "color",
            "operator_input.constraints": '{"min":"#000000"}',
          }),
        ),
      ],
    } as MockSceneNode);
    const r = extractOperatorInputs(root);
    expect(r.inputs).toHaveLength(0);
    expect(r.warnings[0]?.message).toContain('Constraint "min" is not valid for type "color"');
  });

  it("warns on duplicate paths and keeps the first", () => {
    const root = equipTree({
      type: "FRAME",
      id: "f:0",
      name: "Root",
      width: 100,
      height: 100,
      children: [
        equipTree(
          operatorInput("oi:1", {
            "operator_input.path": "__inputs.x",
            "operator_input.type": "string",
          }),
        ),
        equipTree(
          operatorInput("oi:2", {
            "operator_input.path": "__inputs.x",
            "operator_input.type": "number",
          }),
        ),
      ],
    } as MockSceneNode);
    const r = extractOperatorInputs(root);
    expect(r.inputs).toHaveLength(1);
    expect(r.inputs[0]?.type).toBe("string");
    expect(r.warnings[0]?.message).toContain("Duplicate operator input path");
  });
});
