import { useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Space,
} from 'antd';
import { CloudDownloadOutlined, KeyOutlined, WarningOutlined } from '@ant-design/icons';
import { createBackup } from '@/core/keys/backup';
import { logAudit } from '@/core/audit/auditService';
import { downloadJson } from '@/lib/download';
import { errorText } from '@/lib/errors';
import { PasswordStrengthHint } from '@/components/ui/PasswordStrengthHint';

export interface BackupDialogProps {
  open: boolean;
  onClose(): void;
}

export function BackupDialog({ open, onClose }: BackupDialogProps): JSX.Element {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [passphrase, setPassphrase] = useState('');

  const submit = async (): Promise<void> => {
    setError(undefined);
    try {
      const values = await form.validateFields();
      setLoading(true);
      const bundle = await createBackup({
        masterPassword: values.masterPassword,
        backupPassphrase: values.backupPassphrase,
      });
      const date = new Date().toISOString().slice(0, 10);
      downloadJson(bundle, `secure-vault-backup-${date}.sfbackup`);
      await logAudit('key.backup', 'success');
      message.success('密钥备份已创建（.sfbackup）');
      form.resetFields();
      setPassphrase('');
      onClose();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      setError(errorText(err));
      await logAudit('key.backup', 'failure');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title="创建密钥备份"
      width={620}
      onCancel={() => {
        if (loading) return;
        form.resetFields();
        setPassphrase('');
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
          key="backup"
          type="primary"
          icon={<CloudDownloadOutlined />}
          loading={loading}
          onClick={() => void submit()}
        >
          生成备份文件
        </Button>,
      ]}
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message="备份不含文件内容"
          description="文件请用 .sfv 导出；口令丢失不可恢复。"
        />
        {error && <Alert type="error" showIcon message={error} />}
        <Form form={form} name="backup-form" layout="vertical" onFinish={() => void submit()}>
          <Form.Item
            name="masterPassword"
            label="当前保管库主口令（重新验证）"
            rules={[{ required: true, message: '请输入主口令' }]}
          >
            <Input.Password size="large" prefix={<KeyOutlined />} placeholder="主口令" />
          </Form.Item>
          <Form.Item
            name="backupPassphrase"
            label="备份口令（独立口令，至少 12 位）"
            rules={[
              { required: true, message: '请设置备份口令' },
              { min: 12, message: '备份口令至少 12 位' },
            ]}
          >
            <Input.Password
              size="large"
              prefix={<KeyOutlined />}
              placeholder="备份口令"
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </Form.Item>
          <PasswordStrengthHint value={passphrase} minLength={12} />
          <Form.Item
            name="confirm"
            label="确认备份口令"
            dependencies={['backupPassphrase']}
            rules={[
              { required: true, message: '请确认备份口令' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('backupPassphrase') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入不一致'));
                },
              }),
            ]}
          >
            <Input.Password size="large" prefix={<KeyOutlined />} placeholder="再次输入" />
          </Form.Item>
        </Form>
      </Space>
    </Modal>
  );
}
