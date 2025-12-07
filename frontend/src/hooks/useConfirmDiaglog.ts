import { useState, useCallback } from "react";

export interface ConfirmDialogOptions {
  title?: string;
  message?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export interface ConfirmDialogResult {
  open: (options?: ConfirmDialogOptions) => void;
  close: () => void;
  isOpen: boolean;
  options: ConfirmDialogOptions;
  onConfirm: () => void;
  onCancel: () => void;
}

export function useConfirmDialog(
  onConfirmCallback?: () => void, // ✅ Thêm dấu ? để optional
  onCancelCallback?: () => void
): ConfirmDialogResult {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [options, setOptions] = useState<ConfirmDialogOptions>({
    title: "Confirm Action",
    message: "Are you sure?",
  });

  const open = useCallback((opts?: ConfirmDialogOptions) => {
    if (opts) {
      setOptions(opts);
    }
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const onConfirm = useCallback(() => {
    setIsOpen(false);
    // ✅ Ưu tiên callback từ options
    if (options.onConfirm) {
      options.onConfirm();
    } else if (onConfirmCallback) {
      onConfirmCallback();
    }
  }, [options, onConfirmCallback]);

  const onCancel = useCallback(() => {
    setIsOpen(false);
    if (options.onCancel) {
      options.onCancel();
    } else if (onCancelCallback) {
      onCancelCallback();
    }
  }, [options, onCancelCallback]);

  return {
    open,
    close,
    isOpen,
    options,
    onConfirm,
    onCancel,
  };
}
