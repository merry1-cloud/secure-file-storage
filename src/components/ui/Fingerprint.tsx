import { App as AntApp, Button, Tooltip, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { groupFingerprint, shortFingerprint } from '@/lib/format';

const { Text } = Typography;

export interface FingerprintProps {
  value: string;
  short?: boolean;
  copyable?: boolean;
  className?: string;
}

export function Fingerprint({
  value,
  short = false,
  copyable = true,
  className,
}: FingerprintProps): JSX.Element {
  const { message } = AntApp.useApp();
  const display = short ? shortFingerprint(value) : groupFingerprint(value);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      message.success('指纹已复制');
    } catch {
      message.error('复制失败，请手动选择');
    }
  };
  return (
    <span className={`fingerprint-inline ${className ?? ''}`}>
      <Tooltip title={<span className="mono">{groupFingerprint(value)}</span>}>
        <Text className="mono fingerprint-text" copyable={false}>
          {display}
        </Text>
      </Tooltip>
      {copyable && (
        <Tooltip title="复制完整指纹">
          <Button
            type="text"
            size="small"
            icon={<CopyOutlined />}
            onClick={() => void copy()}
            aria-label="复制证书指纹"
          />
        </Tooltip>
      )}
    </span>
  );
}
