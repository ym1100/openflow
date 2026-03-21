import { describe, it, expect } from "vitest";
import {
  OPENFLOW_UI_REGISTRY,
  buildOpenflowAgentSnapshot,
  openflowAgentCommandsSummary,
  parseOpenflowUiCommandsFromJson,
  type OpenflowAgentCommand,
} from "./openflowAgentCommands";

describe("openflowAgentCommands", () => {
  it("registry includes add-node entry", () => {
    const add = OPENFLOW_UI_REGISTRY.find((e) => e.ref === "ui.addNode");
    expect(add?.dataId).toBe("add-node-button");
  });

  it("buildOpenflowAgentSnapshot returns text and refs object", () => {
    const snap = buildOpenflowAgentSnapshot();
    expect(snap.text).toContain("Openflow UI snapshot");
    expect(snap.refs["ui.addNode"]).toBeDefined();
    expect(snap.refs["ui.addNode"].selector).toContain("add-node-button");
  });

  it("openflowAgentCommandsSummary serializes commands", () => {
    const cmds: OpenflowAgentCommand[] = [
      { type: "wait", ms: 50 },
      { type: "click", target: { kind: "ref", ref: "ui.addNode" } },
    ];
    expect(openflowAgentCommandsSummary(cmds)).toContain("ui.addNode");
  });

  it("parseOpenflowUiCommandsFromJson accepts valid planner entries", () => {
    const parsed = parseOpenflowUiCommandsFromJson([
      { type: "wait", ms: 10 },
      { type: "click", target: { kind: "ref", ref: "ui.addNode" } },
      { type: "snapshot" },
    ]);
    expect(parsed).toEqual([
      { type: "wait", ms: 10 },
      { type: "click", target: { kind: "ref", ref: "ui.addNode" } },
      { type: "snapshot" },
    ]);
  });

  it("parseOpenflowUiCommandsFromJson drops invalid items", () => {
    expect(parseOpenflowUiCommandsFromJson(null)).toEqual([]);
    expect(parseOpenflowUiCommandsFromJson("x")).toEqual([]);
    expect(
      parseOpenflowUiCommandsFromJson([
        null,
        { type: "click" },
        { type: "click", target: { kind: "agentNodeType", nodeType: "notARealType" } },
        { type: "wait", ms: "nope" },
        { type: "click", target: { kind: "ref", ref: "ui.runBar" } },
      ])
    ).toEqual([{ type: "click", target: { kind: "ref", ref: "ui.runBar" } }]);
  });
});
