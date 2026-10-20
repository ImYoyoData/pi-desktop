import { App as AntApp, message as staticMessage, Modal } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import type { NotificationInstance } from "antd/es/notification/interface";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type DialogOptions = {
  title?: ReactNode;
  content?: ReactNode;
  positiveText?: string;
  negativeText?: string;
  /** 返回 false 时对话框保持打开。 */
  onPositiveClick?: () => void | boolean | Promise<void | boolean>;
  onNegativeClick?: () => void;
  onClose?: () => void;
};

/** 对话框句柄：可切换确定按钮的加载态，也可主动关闭。 */
export type DialogHandle = {
  loading: boolean;
  destroy: () => void;
};

export type DialogApi = {
  create: (options: DialogOptions) => DialogHandle;
  info: (options: DialogOptions) => DialogHandle;
  success: (options: DialogOptions) => DialogHandle;
  warning: (options: DialogOptions) => DialogHandle;
  error: (options: DialogOptions) => DialogHandle;
};

const MessageContext = createContext<MessageInstance | null>(null);
const NotificationContext = createContext<NotificationInstance | null>(null);
const DialogContext = createContext<DialogApi | null>(null);

/** 进程级（含 store 内）可用的 message 实例。 */
let globalMessage: MessageInstance = staticMessage;

export function getMessage(): MessageInstance {
  return globalMessage;
}

function DialogHost({ children }: { children: ReactNode }): ReactNode {
  const [request, setRequest] = useState<DialogOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const current = useRef<DialogOptions | null>(null);
  const loadingRef = useRef(false);

  const close = useCallback((): void => {
    current.current = null;
    loadingRef.current = false;
    setLoading(false);
    setRequest(null);
  }, []);

  const open = useCallback(
    (options: DialogOptions): DialogHandle => {
      current.current = options;
      loadingRef.current = false;
      setLoading(false);
      setRequest(options);
      return {
        get loading(): boolean {
          return loadingRef.current;
        },
        set loading(next: boolean) {
          loadingRef.current = next;
          setLoading(next);
        },
        destroy: close,
      };
    },
    [close],
  );

  const dialog = useMemo<DialogApi>(
    () => ({
      create: open,
      info: open,
      success: open,
      warning: open,
      error: open,
    }),
    [open],
  );

  const handleOk = async (): Promise<void> => {
    const options = current.current;
    const result = await options?.onPositiveClick?.();
    if (result === false) return;
    close();
    options?.onClose?.();
  };

  const handleCancel = (): void => {
    const options = current.current;
    close();
    options?.onNegativeClick?.();
    options?.onClose?.();
  };

  return (
    <DialogContext.Provider value={dialog}>
      {children}
      <Modal
        open={request !== null}
        title={request?.title}
        okText={request?.positiveText}
        cancelText={request?.negativeText}
        confirmLoading={loading}
        onOk={() => void handleOk()}
        onCancel={handleCancel}
        destroyOnHidden
      >
        {request?.content}
      </Modal>
    </DialogContext.Provider>
  );
}

/**
 * 全局反馈服务：把 antd 的 message / notification 挂到上下文，
 * 并提供与组件库 useDialog 语义一致的对话框 API。
 */
export function FeedbackProvider({ children }: { children: ReactNode }): ReactNode {
  const { message, notification } = AntApp.useApp();
  globalMessage = message;
  return (
    <MessageContext.Provider value={message}>
      <NotificationContext.Provider value={notification}>
        <DialogHost>{children}</DialogHost>
      </NotificationContext.Provider>
    </MessageContext.Provider>
  );
}

export function useMessage(): MessageInstance {
  return useContext(MessageContext) ?? staticMessage;
}

export function useDialog(): DialogApi {
  const dialog = useContext(DialogContext);
  if (!dialog) throw new Error("useDialog 必须在 FeedbackProvider 内使用");
  return dialog;
}

export function useNotification(): NotificationInstance {
  const notification = useContext(NotificationContext);
  if (!notification) throw new Error("useNotification 必须在 FeedbackProvider 内使用");
  return notification;
}
