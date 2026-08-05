import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TreeHierarchy } from "./tree-hierarchy.js";

interface Node {
  readonly id: string;
  readonly parentId: string | undefined;
}

const node = (id: string, parentId?: string): Node => ({ id, parentId });

/**
 *   a          d
 *   ├── b      └── e
 *   │   └── c
 *   └── f
 */
const sample = (): TreeHierarchy<Node> =>
  new TreeHierarchy<Node>([
    node("a"),
    node("b", "a"),
    node("c", "b"),
    node("f", "a"),
    node("d"),
    node("e", "d"),
  ]);

const ids = (nodes: readonly Node[]): string[] => nodes.map((n) => n.id);

describe("TreeHierarchy", () => {
  it("indexes every node and exposes the roots in insertion order", () => {
    const hierarchy = sample();
    assert.equal(hierarchy.size, 6);
    assert.equal(hierarchy.find("c")?.parentId, "b");
    assert.equal(hierarchy.find("missing"), undefined);
    assert.deepEqual(ids(hierarchy.roots()), ["a", "d"]);
    assert.deepEqual(ids(hierarchy.childrenOf("a")), ["b", "f"]);
    assert.deepEqual(hierarchy.childrenOf("c"), []);
  });

  it("walks ancestors from the nearest parent up to the root", () => {
    assert.deepEqual(ids(sample().ancestorsOf("c")), ["b", "a"]);
    assert.deepEqual(sample().ancestorsOf("a"), []);
  });

  it("stops instead of looping when the stored data contains a cycle", () => {
    const cyclic = new TreeHierarchy<Node>([
      node("x", "y"),
      node("y", "z"),
      node("z", "x"),
    ]);

    assert.deepEqual(ids(cyclic.ancestorsOf("x")), ["y", "z"]);
    assert.equal(cyclic.depthOf("x"), 2);
  });

  it("lists descendants in breadth-first order", () => {
    const hierarchy = new TreeHierarchy<Node>([
      node("root"),
      node("l1a", "root"),
      node("l1b", "root"),
      node("l2a", "l1a"),
      node("l2b", "l1b"),
      node("l3a", "l2a"),
    ]);

    assert.deepEqual(ids(hierarchy.descendantsOf("root")), [
      "l1a",
      "l1b",
      "l2a",
      "l2b",
      "l3a",
    ]);
    assert.deepEqual(hierarchy.descendantsOf("l3a"), []);
  });

  it("reports depth counting roots as zero", () => {
    const hierarchy = sample();
    assert.equal(hierarchy.depthOf("a"), 0);
    assert.equal(hierarchy.depthOf("b"), 1);
    assert.equal(hierarchy.depthOf("c"), 2);
    assert.equal(hierarchy.depthOf("missing"), 0);
  });

  it("answers descendancy in both directions", () => {
    const hierarchy = sample();
    assert.equal(hierarchy.isDescendantOf("c", "a"), true);
    assert.equal(hierarchy.isDescendantOf("c", "b"), true);
    assert.equal(hierarchy.isDescendantOf("a", "c"), false);
    assert.equal(hierarchy.isDescendantOf("c", "d"), false);
    assert.equal(hierarchy.isDescendantOf("a", "a"), false);
  });

  it("builds the nested tree from the roots down", () => {
    const tree = sample().tree();

    assert.deepEqual(
      tree.map((n) => n.node.id),
      ["a", "d"],
    );

    const a = tree[0]!;
    assert.deepEqual(
      a.children.map((n) => n.node.id),
      ["b", "f"],
    );
    assert.deepEqual(
      a.children[0]!.children.map((n) => n.node.id),
      ["c"],
    );
    assert.deepEqual(a.children[1]!.children, []);
  });

  it("lets a subclass reshape the tree nodes", () => {
    interface Named {
      value: Node;
      children: Named[];
    }

    class NamedHierarchy extends TreeHierarchy<Node, Named> {
      protected override wrapNode(n: Node, children: Named[]): Named {
        return { value: n, children };
      }
    }

    const tree = new NamedHierarchy([node("a"), node("b", "a")]).tree();
    assert.equal(tree[0]!.value.id, "a");
    assert.equal(tree[0]!.children[0]!.value.id, "b");
  });
});
