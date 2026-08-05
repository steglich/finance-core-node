import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CostCenterHierarchy } from "./cost-center-hierarchy.js";
import { CostCenter } from "./cost-center.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const OTHER_COMPANY = "22222222-2222-2222-2222-222222222222";

function make(
  id: string,
  name: string,
  parentId?: string,
  companyId = COMPANY,
): CostCenter {
  return new CostCenter({ id, companyId, name, parentId });
}

/**
 *   marketing            rh
 *   └── midia            └── eventos
 *       └── social
 */
function sample(): CostCenterHierarchy {
  return new CostCenterHierarchy([
    make("marketing", "Marketing"),
    make("midia", "Mídia Paga", "marketing"),
    make("social", "Social", "midia"),
    make("rh", "RH"),
    make("eventos", "Eventos", "rh"),
  ]);
}

describe("CostCenter creation", () => {
  it("creates an active root cost center", () => {
    const result = CostCenter.create({ companyId: COMPANY, name: "Marketing" });

    assert.equal(result.isSuccess, true);
    assert.equal(result.value?.isActive, true);
    assert.equal(result.value?.isRoot, true);
  });

  it("creates a child under an active parent", () => {
    const parent = make("marketing", "Marketing");

    const result = CostCenter.create({
      companyId: COMPANY,
      name: "Mídia Paga",
      parent,
    });

    assert.equal(result.value?.parentId, "marketing");
  });

  it("rejects a parent of another company", () => {
    const result = CostCenter.create({
      companyId: COMPANY,
      name: "Mídia Paga",
      parent: make("outro", "Outro", undefined, OTHER_COMPANY),
    });

    assert.equal(result.error?.code, "UNAUTHORIZED_ACCESS");
  });

  it("rejects an inactive parent", () => {
    const parent = make("marketing", "Marketing");
    parent.deactivate();

    const result = CostCenter.create({
      companyId: COMPANY,
      name: "Mídia Paga",
      parent,
    });

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
  });

  it("rejects an empty name and a missing company", () => {
    assert.equal(
      CostCenter.create({ companyId: COMPANY, name: "  " }).error?.code,
      "VALIDATION_ERROR",
    );
    assert.equal(
      CostCenter.create({ companyId: "", name: "Marketing" }).error?.code,
      "COMPANY_CONTEXT_REQUIRED",
    );
  });
});

describe("CostCenterHierarchy placement", () => {
  it("rejects a duplicate name among siblings, ignoring case", () => {
    const result = sample().canPlace(undefined, "  marketing ");

    assert.equal(result.error?.code, "DUPLICATE_ENTITY");
  });

  it("accepts the same name under a different parent", () => {
    assert.equal(sample().canPlace("marketing", "Eventos").isSuccess, true);
  });

  it("accepts a second level and a third level", () => {
    const hierarchy = sample();

    assert.equal(hierarchy.canPlace("rh", "Recrutamento").isSuccess, true);
    assert.equal(hierarchy.canPlace("eventos", "Feiras").isSuccess, true);
  });

  it("rejects a fourth level", () => {
    const result = sample().canPlace("social", "Instagram");

    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("rejects an unknown or inactive parent", () => {
    const hierarchy = sample();
    assert.equal(hierarchy.canPlace("missing", "X").error?.code, "ENTITY_NOT_FOUND");

    hierarchy.find("rh")!.deactivate();
    assert.equal(
      hierarchy.canPlace("rh", "X").error?.code,
      "BUSINESS_RULE_VIOLATION",
    );
  });

  it("ignores the node itself when it is being renamed in place", () => {
    assert.equal(
      sample().canPlace(undefined, "Marketing", "marketing").isSuccess,
      true,
    );
  });
});

describe("CostCenterHierarchy moves", () => {
  it("moves a subtree under another parent", () => {
    const hierarchy = sample();

    const result = hierarchy.move("midia", "rh");

    assert.equal(result.isSuccess, true);
    assert.equal(hierarchy.find("midia")?.parentId, "rh");
  });

  it("promotes a node to the root", () => {
    const hierarchy = sample();

    assert.equal(hierarchy.move("midia", undefined).isSuccess, true);
    assert.equal(hierarchy.find("midia")?.parentId, undefined);
  });

  it("rejects moving a node under its own descendant", () => {
    const result = sample().move("marketing", "social");

    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("rejects moving a node under itself", () => {
    assert.equal(sample().move("marketing", "marketing").isFailure, true);
  });

  it("rejects a move that would push the subtree past the depth limit", () => {
    // "marketing" carries two levels below it; hanging it under "eventos"
    // (already at depth 1) would produce a fourth level.
    const result = sample().move("marketing", "eventos");

    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("rejects a move across companies", () => {
    const hierarchy = new CostCenterHierarchy([
      make("marketing", "Marketing"),
      make("outro", "Outro", undefined, OTHER_COMPANY),
    ]);

    assert.equal(
      hierarchy.move("marketing", "outro").error?.code,
      "UNAUTHORIZED_ACCESS",
    );
  });

  it("rejects a move that collides with a sibling name", () => {
    const hierarchy = new CostCenterHierarchy([
      make("marketing", "Marketing"),
      make("rh", "RH"),
      make("eventos-a", "Eventos", "marketing"),
      make("eventos-b", "Eventos", "rh"),
    ]);

    assert.equal(
      hierarchy.move("eventos-b", "marketing").error?.code,
      "DUPLICATE_ENTITY",
    );
  });

  it("reports an unknown node or parent", () => {
    const hierarchy = sample();
    assert.equal(hierarchy.move("missing", "rh").error?.code, "ENTITY_NOT_FOUND");
    assert.equal(
      hierarchy.move("midia", "missing").error?.code,
      "ENTITY_NOT_FOUND",
    );
  });
});

describe("CostCenterHierarchy deactivation", () => {
  it("cascades over the descendants", () => {
    const hierarchy = sample();

    const result = hierarchy.deactivate("marketing");

    assert.equal(result.isSuccess, true);
    assert.deepEqual(
      result.value?.map((node) => node.id),
      ["marketing", "midia", "social"],
    );
    assert.equal(hierarchy.find("social")?.isActive, false);
    assert.equal(hierarchy.find("rh")?.isActive, true);
  });

  it("rejects the whole cascade when an active budget references any node", () => {
    const hierarchy = sample();

    const result = hierarchy.deactivate(
      "marketing",
      new Map([["social", 1]]),
    );

    assert.equal(result.error?.code, "BUSINESS_RULE_VIOLATION");
    // Nothing is left half deactivated.
    assert.equal(hierarchy.find("marketing")?.isActive, true);
    assert.equal(hierarchy.find("midia")?.isActive, true);
  });

  it("rejects deactivating twice and reports an unknown node", () => {
    const hierarchy = sample();
    hierarchy.deactivate("rh");

    assert.equal(hierarchy.deactivate("rh").error?.code, "INVALID_OPERATION");
    assert.equal(
      hierarchy.deactivate("missing").error?.code,
      "ENTITY_NOT_FOUND",
    );
  });

  it("keeps an inactive cost center out of edits and moves", () => {
    const costCenter = make("marketing", "Marketing");
    costCenter.deactivate();

    assert.equal(costCenter.edit({ name: "Novo" }).error?.code, "INVALID_OPERATION");
    assert.equal(costCenter.moveTo(undefined).error?.code, "INVALID_OPERATION");
  });
});

describe("CostCenterHierarchy reading", () => {
  it("builds the tree with the cost center under its own key", () => {
    const tree = sample().tree();

    assert.deepEqual(
      tree.map((node) => node.costCenter.id),
      ["marketing", "rh"],
    );
    assert.equal(tree[0]!.children[0]!.costCenter.id, "midia");
    assert.equal(tree[0]!.children[0]!.children[0]!.costCenter.id, "social");
  });

  it("inherits the generic traversal", () => {
    const hierarchy = sample();

    assert.equal(hierarchy.size, 5);
    assert.equal(hierarchy.depthOf("social"), 2);
    assert.equal(hierarchy.isDescendantOf("social", "marketing"), true);
    assert.deepEqual(
      hierarchy.descendantsOf("marketing").map((node) => node.id),
      ["midia", "social"],
    );
  });
});
