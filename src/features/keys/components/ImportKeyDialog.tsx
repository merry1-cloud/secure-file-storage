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
import { importPrivateKeyExport } from '@/core/keys/exportKey';
import { useSessionStore } from '@/store/sessionStore';
import { errorText } from '@/lib/errors';

const { Text } = Typography;

export interface ImportKeyDialogProps {
  open: boolean;
  onClose(): void;
  onImported(): void;
}

export function ImportKeyDialog({
  open,
  onClose,
  onImported,
}: ImportKeyDialogProps): JSX.Element {
  const { message } = AntApp.useApp();
  const keyring = useSessionStore((state) => state.keyring);
  const replaceSigningKey = useSessionStore((state) => state.replaceSigningKey);
  const [form] = Form.useForm();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (): Promise<void> => {
    setError(undefined);
    if (!file) {
      setError('请选择 .sfkey 私钥导出文件');
      return;
    }
    try {
      const values = await form.validateFields();
      setLoading(true);
      const text = await file.text();
      const material = await importPrivateKeyExport(text, values.exportPassphrase);
      await replaceSigningKey({
        currentPassword: values.currentPassword,
        pkcs8: material.pkcs8,
        certInfo: material.certInfo,
        publicKeyJwk: material.publicKeyJwk,
        displayName: keyring?.displayName ?? 'Imported Key',
        trustedCerts: [],
      });
      message.success('私钥导入成功，签名证书已切换');
      form.resetFields();
      setFile(null);
      onImported();
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
      title="导入 RSA 私钥（.sfkey）"
      width={620}
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
          key="import"
          type="primary"
          icon={<ImportOutlined />}
          loading={loading}
          onClick={() => void submit()}
        >
          导入并切换签名密钥
        </Button>,
      ]}
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message="仅替换签名密钥"
          description="旧证书仍可验证；仅支持本应用 .sfkey。"
        />
        {error && <Alert type="error" showIcon message={error} />}
        <Form form={form} name="import-key-form" layout="vertical" onFinish={() => void submit()}>
          <Form.Item label="私钥文件 (.sfkey)" required>
            <div className="file-picker">
              <input
                type="file"
                accept=".sfkey,application/json"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setError(undefined);
                }}
              />
              <span className="file-picker-name">
                {file ? file.name : '选择 .sfkey 文件'}
              </span>
            </div>
          </Form.Item>
          <Form.Item
            name="exportPassphrase"
            label="导出时设置的私钥口令"
            rules={[{ required: true, message: '请输入导出口令' }]}
          >
            <Input.Password
              size="large"
              prefix={<KeyOutlined />}
              placeholder="导出口令"
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
          <Text type="secondary">导入前校验完整性与密钥匹配。</Text>
        </Form>
      </Space>
    </Modal>
  );
}
