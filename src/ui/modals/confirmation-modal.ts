import { App, Modal } from "obsidian";

/**
 * Simple confirmation modal to replace browser confirm()
 */
export class ConfirmationModal extends Modal {
  private message: string;
  private confirmText: string;
  private cancelText: string;
  private onConfirm: () => void;
  private onCancel?: () => void;

  constructor(
    app: App,
    options: {
      message: string;
      confirmText?: string;
      cancelText?: string;
      onConfirm: () => void;
      onCancel?: () => void;
    }
  ) {
    super(app);
    this.message = options.message;
    this.confirmText = options.confirmText || "Confirm";
    this.cancelText = options.cancelText || "Cancel";
    this.onConfirm = options.onConfirm;
    this.onCancel = options.onCancel;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("evc-sync-modal", "evc-confirmation-modal");

    // Title
    contentEl.createEl("h2", { text: "Confirm action" });

    // Message
    contentEl.createEl("p", {
      text: this.message,
      cls: "evc-confirmation-message",
    });

    // Buttons
    const buttonsEl = contentEl.createDiv({ cls: "evc-modal-buttons" });

    // Cancel button
    const cancelBtn = buttonsEl.createEl("button", {
      text: this.cancelText,
      cls: "evc-btn",
    });
    cancelBtn.addEventListener("click", () => {
      this.onCancel?.();
      this.close();
    });

    // Confirm button
    const confirmBtn = buttonsEl.createEl("button", {
      text: this.confirmText,
      cls: "evc-btn evc-btn-cta mod-cta",
    });
    confirmBtn.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Helper function to show confirmation modal and return a promise
 */
export function showConfirmation(
  app: App,
  message: string,
  confirmText?: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new ConfirmationModal(app, {
      message,
      confirmText,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
    modal.open();
  });
}
