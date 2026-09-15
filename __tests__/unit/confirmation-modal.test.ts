/**
 * Unit tests: ConfirmationModal / showConfirmation.
 *
 * Regression for: closing the modal via Esc or backdrop click (i.e. any path
 * OTHER than clicking Cancel/Confirm) never called onClose()'s onCancel(),
 * leaving showConfirmation()'s promise unresolved forever — which hangs a
 * sync cycle mid deletion-confirmation. Obsidian routes Esc/backdrop through
 * the same onClose() as an explicit close(); MockModal in the obsidian mock
 * reproduces that by having close() call onClose() directly, with no button
 * click involved.
 */

import { describe, test, expect } from "@jest/globals";
import { App, makeVaultMock, Modal } from "../mocks/obsidian";
import { ConfirmationModal, showConfirmation } from "../../src/ui/modals/confirmation-modal";

function makeApp(): App {
	return new App(makeVaultMock("/tmp/evc-ls-confirmation-modal-test"));
}

describe("ConfirmationModal", () => {
	test("Esc/backdrop close (no button click) resolves via onCancel, not left hanging", () => {
		const app = makeApp();
		let confirmed: boolean | null = null;
		let cancelled = false;

		const modal = new ConfirmationModal(app, {
			message: "Delete this file?",
			onConfirm: () => {
				confirmed = true;
			},
			onCancel: () => {
				cancelled = true;
			},
		});

		modal.open();
		// Esc / backdrop: Obsidian calls close() directly, bypassing both
		// button handlers entirely.
		modal.close();

		expect(cancelled).toBe(true);
		expect(confirmed).toBeNull();
	});

	test("clicking Cancel calls onCancel exactly once (not double-fired by onClose)", () => {
		const app = makeApp();
		let cancelCount = 0;

		const modal = new ConfirmationModal(app, {
			message: "Delete this file?",
			onConfirm: () => {},
			onCancel: () => {
				cancelCount++;
			},
		});

		modal.open();
		const buttonsEl = modal.contentEl.children.find((c) => c.cls.includes("evc-modal-buttons"))!;
		const cancelBtn = buttonsEl.children.find((c) => c.text === "Cancel")!;
		cancelBtn.click();

		expect(cancelCount).toBe(1);
	});

	test("clicking Confirm calls onConfirm and does NOT also call onCancel via onClose", () => {
		const app = makeApp();
		let confirmed = false;
		let cancelled = false;

		const modal = new ConfirmationModal(app, {
			message: "Delete this file?",
			onConfirm: () => {
				confirmed = true;
			},
			onCancel: () => {
				cancelled = true;
			},
		});

		modal.open();
		const buttonsEl = modal.contentEl.children.find((c) => c.cls.includes("evc-modal-buttons"))!;
		const confirmBtn = buttonsEl.children.find((c) => c.text === "Confirm")!;
		confirmBtn.click();

		expect(confirmed).toBe(true);
		expect(cancelled).toBe(false);
	});

	test("showConfirmation() promise resolves to false on Esc/backdrop instead of hanging forever", async () => {
		const app = makeApp();
		let capturedModal: ConfirmationModal | null = null;

		// showConfirmation constructs a ConfirmationModal internally and calls
		// modal.open() but never exposes it — patch Modal.prototype.open to
		// capture the instance being opened, same technique used to observe a
		// black-box constructor without changing the module under test.
		const realOpen = Modal.prototype.open;
		Modal.prototype.open = function (this: ConfirmationModal) {
			capturedModal = this;
			return realOpen.call(this);
		};

		try {
			const resultPromise = showConfirmation(app, "Delete this file?", "Delete");
			expect(capturedModal).not.toBeNull();
			capturedModal!.close(); // simulate Esc/backdrop

			const result = await resultPromise;
			expect(result).toBe(false);
		} finally {
			Modal.prototype.open = realOpen;
		}
	});
});
