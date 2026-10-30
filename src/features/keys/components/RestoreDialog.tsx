import { useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Space,
  Typography,
} from 'antd';
import { ImportOutlined, KeyOutlined, WarningOutlined } from '@ant-design/icons';
import { restoreBackup } from '@/core/keys/backup';
import { useSessionStore } from '@/store/sessionStore';
import { errorText } from '@/lib/errors';

const { Text } = Typography;

export interface RestoreDialogProps {
  open: boolean;
  onClose(): void;
  onRestored(): void;
}

export function RestoreDialog({
  open,
  onClose,
  onRestored,
}: RestoreDialogProps): JSX.Element {
  const { message } = AntApp.useApp();
  const replaceSigningKey = useSessionStore((state) => state.replaceSigningKey);
  const [form] = Form.useForm();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (): Promise<void> => {
    setError(undefined);
    if (!file) {
      setError('请选择 .sfbackup 文件');
      return;
    }
    try {
      const values = await form.validateFields();
      setLoading(true);
      const text = await file.text();
      const material = await restoreBackup(text, values.backupPassphrase);
      await replaceSigningKey({
        currentPassword: values.currentPassword,
        pkcs8: material.pkcs8,
        certInfo: material.certInfo,
        publicKeyJwk: material.publicKeyJwk,
        displayName: material.displayName,
        trustedCerts: material.trustedCerts,
      });
      message.success('备份恢复成功，签名密钥已替换');
      form.resetFields();
      setFile(null);
      onRestored();
      onClose();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title="从密钥备份恢复"
      width={640}
      onCancel={() => {
        if (loading) return;
        setError(undefined);
        onClose();
      }}
      closable={!loading}
      maskClosable={false}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onClose} disabled={loading}>
          取消
        </Button>,
        <Button
          key="restore"
          type="primary"
          icon={<ImportOutlined />}
          loading={loading}
          onClick={() => void submit()}
        >
          恢复并替换签名密钥
        </Button>,
      ]}
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message="仅替换签名密钥"
          description="旧证书仍可验证；备份不含文件。"
        />
        {error && <Alert type="error" showIcon message={error} />}
        <Form form={form} name="restore-key-form" layout="vertical" onFinish={() => void submit()}>
          <Form.Item label="备份文件 (.sfbackup)" required>
            <div className="file-picker">
              <input
                type="file"
                accept=".sfbackup,application/json"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setError(undefined);
                }}
              />
              <span className="file-picker-name">
                {file ? file.name : '选择 .sfbackup 文件'}
              </span>
            </div>
          </Form.Item>
          <Form.Item
            name="backupPassphrase"
            label="备份口令"
            rules={[{ required: true, message: '请输入备份口令' }]}
          >
            <Input.Password
              size="large"
              prefix={<KeyOutlined />}
              placeholder="创建备份时设置的口令"
            />
          </Form.Item>
          <Form.Item
            name="currentPassword"
            label="当前保管库主口令"
            rules={[{ required: true, message: '请输入当前主口令' }]}
            extra="用当前主口令重包私钥。"
          >
            <Input.Password size="large" prefix={<KeyOutlined />} placeholder="当前主口令" />
          </Form.Item>
          <Text type="secondary">恢复前校验一致性；失败不改密钥环。</Text>
        </Form>
      </Space>
    </Modal>
  );
}
