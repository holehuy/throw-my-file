import type { ConfirmDialogOptions } from "../hooks/useConfirmDiaglog";

interface ConfirmModalProps {
  show: boolean;
  options: ConfirmDialogOptions;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  show,
  options,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!show) return null;

  return (
    <>
      <div className="modal-backdrop show" style={{ opacity: 0.3 }}></div>

      <div className="modal d-block" tabIndex={-1}>
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content shadow">
            <div className="modal-header">
              <h5 className="modal-title">{options.title}</h5>
            </div>

            <div className="modal-body">
              <p className="mb-0">{options.message}</p>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onCancel}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={onConfirm}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
