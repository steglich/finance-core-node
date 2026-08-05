/**
 * Minimum shape a node must have to take part in a tree hierarchy.
 */
export interface TreeNodeLike {
  readonly id: string;
  readonly parentId: string | undefined;
}

/**
 * A node with its children nested underneath.
 */
export interface TreeNode<T> {
  node: T;
  children: TreeNode<T>[];
}

/**
 * Generic traversal over a flat set of parent-linked nodes.
 * Answers the hierarchy questions an entity cannot answer on its own
 * (ancestors, descendants, depth, tree) and tolerates cycles in stored data.
 *
 * Domain-specific rules (moving, deleting, depth limits) belong to subclasses.
 */
export class TreeHierarchy<T extends TreeNodeLike, N = TreeNode<T>> {
  protected readonly byId: Map<string, T>;
  protected readonly childrenByParentId: Map<string | undefined, T[]>;

  constructor(nodes: readonly T[]) {
    this.byId = new Map();
    this.childrenByParentId = new Map();

    for (const node of nodes) {
      this.byId.set(node.id, node);
      const siblings = this.childrenByParentId.get(node.parentId);
      if (siblings) {
        siblings.push(node);
      } else {
        this.childrenByParentId.set(node.parentId, [node]);
      }
    }
  }

  get size(): number {
    return this.byId.size;
  }

  find(nodeId: string): T | undefined {
    return this.byId.get(nodeId);
  }

  /**
   * Root nodes, in insertion order.
   */
  roots(): T[] {
    return [...(this.childrenByParentId.get(undefined) ?? [])];
  }

  childrenOf(nodeId: string): T[] {
    return [...(this.childrenByParentId.get(nodeId) ?? [])];
  }

  /**
   * Ancestors from the nearest parent up to the root.
   * Stops safely if the stored data contains a cycle.
   */
  ancestorsOf(nodeId: string): T[] {
    const ancestors: T[] = [];
    const visited = new Set<string>([nodeId]);

    let current = this.byId.get(nodeId)?.parentId;
    while (current !== undefined && !visited.has(current)) {
      const parent = this.byId.get(current);
      if (!parent) {
        break;
      }
      ancestors.push(parent);
      visited.add(parent.id);
      current = parent.parentId;
    }

    return ancestors;
  }

  /**
   * All descendants, in breadth-first order.
   */
  descendantsOf(nodeId: string): T[] {
    const descendants: T[] = [];
    const queue = this.childrenOf(nodeId);
    const visited = new Set<string>([nodeId]);

    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || visited.has(node.id)) {
        continue;
      }
      visited.add(node.id);
      descendants.push(node);
      queue.push(...this.childrenOf(node.id));
    }

    return descendants;
  }

  /**
   * Depth of a node in the tree (0 for roots).
   */
  depthOf(nodeId: string): number {
    return this.ancestorsOf(nodeId).length;
  }

  /**
   * Whether `candidateId` is a descendant of `nodeId`.
   */
  isDescendantOf(candidateId: string, nodeId: string): boolean {
    return this.ancestorsOf(candidateId).some(
      (ancestor) => ancestor.id === nodeId,
    );
  }

  /**
   * Shapes a single tree node. Subclasses that expose a domain-specific node
   * shape (a different field name, extra data) override this instead of `tree()`.
   */
  protected wrapNode(node: T, children: N[]): N {
    // Safe for the default `N = TreeNode<T>`; any other `N` must override.
    return { node, children } as N;
  }

  /**
   * Builds the nested tree.
   */
  tree(): N[] {
    const buildNodes = (nodes: readonly T[]): N[] =>
      nodes.map((node) =>
        this.wrapNode(node, buildNodes(this.childrenOf(node.id))),
      );

    return buildNodes(this.roots());
  }
}
