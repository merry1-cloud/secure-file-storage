import { useRef, useState, type DragEvent } from 'react';
import { App as AntApp, Button, Typography } from 'antd';
import { InboxOutlined, PlusOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

export interface DropZoneProps {
  onFiles(files: File[]): void;
  disabled?: boolean;
}

export function DropZone({ onFiles, disabled = false }: DropZoneProps): JSX.Element {
  const { message } = AntApp.useApp();
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = (): void => {
    if (!disabled) inputRef.current?.click();
  };

  const emitFiles = (files: File[]): void => {
    if (files.length === 0) return;
    onFiles(files);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (disabled) return;

    const items = Array.from(event.dataTransfer.items ?? []);
    const hasDirectory = items.some((item) => {
      const entry = item.webkitGetAsEntry?.();
      return entry?.isDirectory;
    });
    if (hasDirectory) {
      message.warning('暂不支持拖拽文件夹，请拖入一个或多个文件');
      return;
    }
    const files = items
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    emitFiles(files.length > 0 ? files : Array.from(event.dataTransfer.files));
  };

  return (
    <div
      className={`dropzone ${dragging ? 'dropzone-active' : ''} ${disabled ? 'dropzone-disabled' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault();
        dragCounter.current += 1;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragCounter.current = Math.max(0, dragCounter.current - 1);
        if (dragCounter.current === 0) setDragging(false);
      }}
      onDrop={handleDrop}
      onClick={openPicker}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openPicker();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          emitFiles(files);
        }}
      />
      <div className="dropzone-icon">
        <InboxOutlined />
      </div>
      <Title level={4} className="dropzone-title">
        {dragging ? '松开以加密文件' : '拖拽文件到这里'}
      </Title>
      <Text className="dropzone-hint">
        普通文件加密；<Text code>.sfv</Text> 容器导入验签。
      </Text>
      <div className="dropzone-actions">
        <Button icon={<PlusOutlined />} onClick={(event) => {
          event.stopPropagation();
          openPicker();
        }}>
          选择文件
        </Button>
      </div>
    </div>
  );
}
