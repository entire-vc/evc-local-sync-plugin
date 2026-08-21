/**
 * Unit tests: config-shape diagnostics (#4dce529d).
 *
 * These functions are pure — they judge already-resolved paths and folder names
 * — so nothing is mocked here at all. That is deliberate: the class of bug they
 * detect is a bug in path ARITHMETIC, and arithmetic is exactly what you want to
 * test without a filesystem or an Obsidian runtime in the way.
 *
 * Every positive case below is reconstructed from a real incident. Every negative
 * case exists because a warning that fires on a healthy config is worse than no
 * warning: it trains the user to dismiss it, and the next real one goes unread.
 */

import { describe, test, expect } from "@jest/globals";
import {
	detectFoldSignature,
	detectOverlappingRoots,
	isPathInsideOrEqual,
	type ResolvedMappingRoots,
} from "../src/mapping-diagnostics";

function roots(overrides: Partial<ResolvedMappingRoots> = {}): ResolvedMappingRoots {
	return {
		id: "m1",
		name: "Test Mapping",
		aiRoot: "/Users/x/DevProjects/repo",
		obsRoot: "Vault/Product",
		docsSubdir: "",
		...overrides,
	};
}

describe("isPathInsideOrEqual", () => {
	test("matches identical and nested paths", () => {
		expect(isPathInsideOrEqual("a/b", "a/b")).toBe(true);
		expect(isPathInsideOrEqual("a/b/c", "a/b")).toBe(true);
	});

	test("is segment-aware — a shared prefix is not containment", () => {
		// "docs-extra" starts with "docs" as a STRING but is a different folder.
		// A naive startsWith would report containment and produce a false overlap.
		expect(isPathInsideOrEqual("a/docs-extra", "a/docs")).toBe(false);
	});

	test("is case-insensitive (both incidents happened on macOS)", () => {
		expect(isPathInsideOrEqual("A/Docs/x", "a/docs")).toBe(true);
	});

	test("ignores trailing slashes and empty paths", () => {
		expect(isPathInsideOrEqual("a/b/", "a/b")).toBe(true);
		expect(isPathInsideOrEqual("", "a")).toBe(false);
		expect(isPathInsideOrEqual("a", "")).toBe(false);
	});
});

describe("detectFoldSignature", () => {
	test("fires on the PPE TenderMate shape (#4dce529d)", () => {
		// aiPath was folded from ("…/tendermate" + docsSubdir "docs") to
		// ("…/tendermate/docs" + docsSubdir ""), which moved the vault root up from
		// "PPE TenderMate/docs" to "PPE TenderMate" and left the old root nested.
		const d = detectFoldSignature(
			roots({
				name: "TenderMate",
				aiRoot: "/Users/x/DevProjects/tendermate/docs",
				obsRoot: "PPE TenderMate",
				docsSubdir: "",
			}),
			["docs", "Parsers", "Meetings"]
		);

		expect(d).toBeDefined();
		expect(d?.kind).toBe("folded-docs-subdir");
		expect(d?.mappingName).toBe("TenderMate");
		// The message has to carry BOTH roots — the count tells a user something is
		// wrong, the paths tell them where to look.
		expect(d?.message).toContain("PPE TenderMate");
		expect(d?.message).toContain("/Users/x/DevProjects/tendermate/docs");
	});

	test("fires on the dev-docs shape (#9d86c756)", () => {
		const d = detectFoldSignature(
			roots({
				aiRoot: "/Users/x/DevProjects/relay-onprem/dev-docs",
				obsRoot: "Entire VC/Team Relay/docs",
				docsSubdir: "",
			}),
			["dev-docs", "adrs"]
		);

		expect(d).toBeDefined();
		expect(d?.kind).toBe("folded-docs-subdir");
	});

	test("matches the subfolder case-insensitively", () => {
		const d = detectFoldSignature(
			roots({ aiRoot: "/repo/Docs", obsRoot: "Vault/P", docsSubdir: "" }),
			["docs"]
		);
		expect(d).toBeDefined();
	});

	test("negative control: silent when docsSubdir is still set", () => {
		// This is the load-bearing negative. The plugin's OWN default new-mapping
		// shape gives both sides a matching "/docs" suffix — so without this
		// narrowing the check would fire on the common, correct configuration as
		// readily as on the folded one, which is how a warning gets ignored.
		const d = detectFoldSignature(
			roots({ aiRoot: "/repo/docs", obsRoot: "Vault/P", docsSubdir: "docs" }),
			["docs"]
		);
		expect(d).toBeUndefined();
	});

	test("negative control: silent when no child folder matches the AI root basename", () => {
		const d = detectFoldSignature(
			roots({ aiRoot: "/repo/docs", obsRoot: "Vault/P", docsSubdir: "" }),
			["images", "archive"]
		);
		expect(d).toBeUndefined();
	});

	test("negative control: silent on an empty vault folder", () => {
		const d = detectFoldSignature(
			roots({ aiRoot: "/repo/docs", obsRoot: "Vault/P", docsSubdir: "" }),
			[]
		);
		expect(d).toBeUndefined();
	});

	test("negative control: silent when the AI root has no basename", () => {
		const d = detectFoldSignature(
			roots({ aiRoot: "/", obsRoot: "Vault/P", docsSubdir: "" }),
			["docs"]
		);
		expect(d).toBeUndefined();
	});

	test("whitespace-only docsSubdir counts as empty, not as set", () => {
		// getAiDocsPath()/getObsidianDocsPath() both treat "  " as absent, so this
		// check must agree with them or it would go silent on a folded mapping
		// whose docsSubdir field merely contains a stray space.
		const d = detectFoldSignature(
			roots({ aiRoot: "/repo/docs", obsRoot: "Vault/P", docsSubdir: "   " }),
			["docs"]
		);
		expect(d).toBeDefined();
	});
});

describe("detectOverlappingRoots", () => {
	test("reports the TenderMate/Parsers overlap (#4dce529d)", () => {
		const all: ResolvedMappingRoots[] = [
			roots({ id: "a", name: "TenderMate", obsRoot: "PPE TenderMate", aiRoot: "/p/tendermate/docs" }),
			roots({
				id: "b",
				name: "TenderMate Parsers",
				obsRoot: "PPE TenderMate/Parsers",
				aiRoot: "/p/tendermate-parsers/docs",
			}),
		];

		const found = detectOverlappingRoots(all);
		const obsOverlaps = found.filter((d) => d.kind === "overlapping-obs-root");

		// Reported ONCE, attributed to the inner mapping — that is the half whose
		// placement can actually be changed.
		expect(obsOverlaps).toHaveLength(1);
		expect(obsOverlaps[0].mappingName).toBe("TenderMate Parsers");
		expect(obsOverlaps[0].message).toContain("PPE TenderMate");
	});

	test("reports overlapping AI roots independently of vault roots", () => {
		const all: ResolvedMappingRoots[] = [
			roots({ id: "a", name: "Outer", aiRoot: "/p/repo", obsRoot: "Vault/A" }),
			roots({ id: "b", name: "Inner", aiRoot: "/p/repo/sub", obsRoot: "Vault/B" }),
		];

		const found = detectOverlappingRoots(all);
		expect(found.filter((d) => d.kind === "overlapping-ai-root")).toHaveLength(1);
		expect(found.filter((d) => d.kind === "overlapping-obs-root")).toHaveLength(0);
	});

	test("negative control: disjoint mappings produce nothing", () => {
		const all: ResolvedMappingRoots[] = [
			roots({ id: "a", name: "A", aiRoot: "/p/one", obsRoot: "Vault/One" }),
			roots({ id: "b", name: "B", aiRoot: "/p/two", obsRoot: "Vault/Two" }),
		];
		expect(detectOverlappingRoots(all)).toEqual([]);
	});

	test("negative control: sibling folders sharing a name prefix do not overlap", () => {
		const all: ResolvedMappingRoots[] = [
			roots({ id: "a", name: "A", aiRoot: "/p/docs", obsRoot: "Vault/Docs" }),
			roots({ id: "b", name: "B", aiRoot: "/p/docs-archive", obsRoot: "Vault/Docs-Archive" }),
		];
		expect(detectOverlappingRoots(all)).toEqual([]);
	});

	test("a single mapping never overlaps itself", () => {
		expect(detectOverlappingRoots([roots()])).toEqual([]);
	});

	test("identical roots on two mappings are not reported as containment", () => {
		// Two mappings pointing at exactly the same root is a different defect
		// (duplicate mapping), already warned about by MappingManager.validate().
		// Reporting it here too would double up on one problem.
		const all: ResolvedMappingRoots[] = [
			roots({ id: "a", name: "A", aiRoot: "/p/one", obsRoot: "Vault/Same" }),
			roots({ id: "b", name: "B", aiRoot: "/p/two", obsRoot: "Vault/Same" }),
		];
		expect(detectOverlappingRoots(all).filter((d) => d.kind === "overlapping-obs-root")).toEqual([]);
	});
});
